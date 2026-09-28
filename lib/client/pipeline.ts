'use client';

export type PipelineStatus = { scoring: number; drafts: number; errors: number };

/**
 * Drives the server-side pipeline to completion, one unit of work per request, with a couple of
 * parallel workers. Resolves when nothing is left to do (or it stops making progress).
 */
export async function runPipeline(onProgress: (s: PipelineStatus, lastError?: string) => void, workers = 2) {
  let idleRounds = 0;
  let stopped = false;
  const worker = async () => {
    while (!stopped) {
      const res = await fetch('/api/pipeline', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onProgress(data.status ?? { scoring: 0, drafts: 0, errors: 0 }, data.error || `Pipeline error ${res.status}`);
        stopped = true;
        return;
      }
      onProgress(data.status, data.error);
      if (data.blocked) {
        stopped = true; // AI quota used up - resume later with "Run now"
        return;
      }
      const left = data.status.scoring + data.status.drafts;
      if (left === 0) {
        stopped = true;
        return;
      }
      if (!data.did) {
        // Another worker holds the remaining items; wait a moment and check again.
        if (++idleRounds > 60) {
          stopped = true;
          return;
        }
        await new Promise((r) => setTimeout(r, 2000));
      } else {
        idleRounds = 0;
      }
    }
  };
  await Promise.all(Array.from({ length: workers }, worker));
}
