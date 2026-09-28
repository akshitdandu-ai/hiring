import { config } from './config';

type Schema = Record<string, unknown>;

export class AIError extends Error {}

// Models whose daily quota ran out, remembered per server instance until the given time.
const exhausted = new Map<string, number>();

/**
 * Calls Gemini with a JSON response schema and returns the parsed object and the model used.
 * Tries each model in GEMINI_MODEL (comma-separated) in turn: a model that is overloaded (503) or
 * out of daily quota is skipped; a short per-minute limit is waited out. Everything happens within
 * `budgetMs` so a serverless call stays under its time limit.
 */
export async function generateJSON<T>(opts: {
  system: string;
  prompt: string;
  schema: Schema;
  temperature?: number;
  budgetMs?: number;
}): Promise<{ data: T; model: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AIError('GEMINI_API_KEY is not set');
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0,
      responseMimeType: 'application/json',
      responseSchema: opts.schema,
    },
  });

  const deadline = Date.now() + (opts.budgetMs ?? 50_000);
  const errors: string[] = [];
  for (let round = 0; round < 3 && Date.now() < deadline; round++) {
    let shortestWait = Infinity;
    for (const model of config.geminiModels) {
      if ((exhausted.get(model) ?? 0) > Date.now()) continue;
      if (Date.now() > deadline - 3_000) break;
      const r = await callOnce(model, key, body, deadline);
      if (r.ok) {
        try {
          return { data: JSON.parse(r.text) as T, model };
        } catch {
          errors.push(`${model}: invalid JSON`);
          continue;
        }
      }
      errors.push(`${model}: ${r.error}`);
      if (r.status === 429) {
        if (/PerDay/i.test(r.raw)) exhausted.set(model, Date.now() + 60 * 60_000);
        else shortestWait = Math.min(shortestWait, r.retryMs ?? 10_000);
      } else if (r.status && r.status !== 503 && r.status < 500 && r.status !== 404) {
        throw new AIError(`${model}: ${r.error}`); // e.g. bad key or bad request - trying other models won't help
      }
    }
    // Every model is busy: wait for the soonest per-minute window, if it fits the budget.
    const wait = Number.isFinite(shortestWait) ? shortestWait : 4_000 * (round + 1);
    if (Date.now() + wait > deadline - 3_000) break;
    await new Promise((res) => setTimeout(res, wait));
  }
  const allDaily = config.geminiModels.every((m) => (exhausted.get(m) ?? 0) > Date.now());
  throw new AIError(
    allDaily
      ? 'Gemini free-tier daily quota is used up on every configured model. Try again later, or enable billing on the Gemini API key.'
      : `Gemini unavailable (${errors.slice(-3).join(' | ').slice(0, 400)})`,
  );
}

async function callOnce(model: string, key: string, body: string, deadline: number) {
  const url = `${config.geminiApiBase}/v1beta/models/${model}:generateContent`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body,
      signal: AbortSignal.timeout(Math.max(5_000, Math.min(40_000, deadline - Date.now()))),
    });
  } catch (e) {
    return { ok: false as const, status: 0, error: `network: ${(e as Error).message}`, raw: '' };
  }
  if (res.ok) {
    const data = await res.json();
    const text: string = (data?.candidates?.[0]?.content?.parts ?? [])
      .map((p: { text?: string; thought?: boolean }) => (p.thought ? '' : p.text || ''))
      .join('');
    if (text) return { ok: true as const, text };
    const why = data?.candidates?.[0]?.finishReason ?? data?.promptFeedback?.blockReason ?? 'unknown';
    return { ok: false as const, status: 0, error: `empty response (${why})`, raw: '' };
  }
  const raw = await res.text();
  let message = raw;
  try {
    message = JSON.parse(raw)?.error?.message ?? raw;
  } catch {}
  const retry = Number(raw.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/)?.[1]);
  return {
    ok: false as const,
    status: res.status,
    error: `${res.status} ${message.split('\n')[0].slice(0, 160)}`,
    raw,
    retryMs: Number.isFinite(retry) ? retry * 1000 + 500 : undefined,
  };
}
