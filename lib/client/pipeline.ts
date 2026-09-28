'use client';

export type PipelineStatus = { scoring: number; drafts: number; errors: number };
export type PipelineNotice = null | 'busy' | 'quota' | 'error';
export type PipelineProgress = { status: PipelineStatus; notice: PipelineNotice; message?: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Drives the server-side pipeline to completion, one unit of work per request, with a couple of
 * parallel workers. When Google's AI is busy it waits and retries on its own; it only stops when
 * everything is done, the daily AI quota is used up, or the server errors.
 */
export async function runPipeline(onProgress: (p: PipelineProgress) => void, workers = 2) {
  let stopped = false;
  let idleRounds = 0;
  const startedAt = Date.now();
  const worker = async () => {
    while (!stopped) {
      let data: { did?: string | null; error?: string; wait?: 'busy' | 'quota'; status?: PipelineStatus };
      try {
        const res = await fetch('/api/pipeline', { method: 'POST' });
        data = await res.json().catch(() => ({}));
        if (!res.ok) {
          onProgress({ status: data.status ?? { scoring: 0, drafts: 0, errors: 0 }, notice: 'error', message: data.error || `Server error ${res.status}` });
          stopped = true;
          return;
        }
      } catch {
        await sleep(5000); // network blip - try again
        continue;
      }
      const status = data.status!;
      if (data.wait === 'quota') {
        onProgress({ status, notice: 'quota' });
        stopped = true;
        return;
      }
      if (data.wait === 'busy') {
        onProgress({ status, notice: 'busy' });
        if (Date.now() - startedAt > 30 * 60_000) {
          stopped = true; // give up after 30 minutes; "Resume" on the dashboard continues later
          return;
        }
        await sleep(20_000);
        continue;
      }
      onProgress({ status, notice: null });
      if (status.scoring + status.drafts === 0) {
        stopped = true;
        return;
      }
      if (!data.did) {
        // Another worker holds the remaining items; wait a moment and check again.
        if (++idleRounds > 90) {
          stopped = true;
          return;
        }
        await sleep(2000);
      } else {
        idleRounds = 0;
      }
    }
  };
  await Promise.all(Array.from({ length: workers }, worker));
}
