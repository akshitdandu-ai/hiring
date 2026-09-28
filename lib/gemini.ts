import { config } from './config';

type Schema = Record<string, unknown>;

export class AIError extends Error {}

/**
 * Calls Gemini with a JSON response schema and returns the parsed object.
 * Retries rate limits / transient errors within `budgetMs` so a serverless call stays under its limit.
 */
export async function generateJSON<T>(opts: {
  system: string;
  prompt: string;
  schema: Schema;
  temperature?: number;
  budgetMs?: number;
}): Promise<T> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AIError('GEMINI_API_KEY is not set');
  const url = `${config.geminiApiBase}/v1beta/models/${config.geminiModel}:generateContent`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0,
      responseMimeType: 'application/json',
      responseSchema: opts.schema,
    },
  });

  const deadline = Date.now() + (opts.budgetMs ?? 45_000);
  let attempt = 0;
  let lastErr = '';
  while (true) {
    attempt++;
    let res: Response | undefined;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body,
        signal: AbortSignal.timeout(Math.max(5_000, deadline - Date.now())),
      });
    } catch (e) {
      lastErr = `network: ${(e as Error).message}`;
    }
    if (res?.ok) {
      const data = await res.json();
      const text: string | undefined = data?.candidates?.[0]?.content?.parts
        ?.map((p: { text?: string }) => p.text || '')
        .join('');
      if (!text) {
        lastErr = `empty response (finishReason: ${data?.candidates?.[0]?.finishReason ?? data?.promptFeedback?.blockReason ?? 'unknown'})`;
      } else {
        try {
          return JSON.parse(text) as T;
        } catch {
          lastErr = 'model returned invalid JSON';
        }
      }
    } else if (res) {
      const errText = await res.text();
      lastErr = `Gemini ${res.status}: ${errText.slice(0, 300)}`;
      if (res.status !== 429 && res.status < 500) throw new AIError(lastErr);
    }
    // Back off: honour a server-suggested retry delay if present, else exponential.
    const suggested = Number(lastErr.match(/"retryDelay":\s*"(\d+)s"/)?.[1]);
    const wait = Number.isFinite(suggested) && suggested > 0 ? suggested * 1000 : Math.min(2000 * 2 ** (attempt - 1), 16_000);
    if (Date.now() + wait > deadline || attempt >= 5) throw new AIError(lastErr);
    await new Promise((r) => setTimeout(r, wait));
  }
}
