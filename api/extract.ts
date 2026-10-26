/**
 * Optional LLM field extractor (Vercel serverless function).
 *
 * POST { message: string, booking: object }  →  { updates: Op[] }
 * Needs ANTHROPIC_API_KEY in the environment. Without it this returns 501 and the app uses its
 * built-in rule-based parser. The reply is JSON only; the client validates it with zod before use,
 * and every assistant message is rendered from templates, never from model text.
 */
interface Req {
  method?: string;
  body?: unknown;
}
interface Res {
  status(code: number): Res;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
}

const SYSTEM = `You extract booking field updates from a seller's chat message for a UK to EU (Germany, France, Netherlands) shipment booking.
Return ONLY a JSON object: {"updates": [...]}. No prose, no code fences.
Each update is one of:
 {"op":"set","field":F,"value":V}            F in sellerName, originCity, destinationCity, destinationCountry, destinationType, readyDate (ISO yyyy-MM-dd), priority, pallets, cartons, declaredValue, grossWeightKg, appointmentBooked (true/false)
 {"op":"increment"|"decrement","field":F,"amount":N}   F in pallets, cartons, declaredValue, grossWeightKg
 {"op":"add_item","item":{"sku","description","hsCode","quantity","unitPrice","unitsPerCarton","cartons","unitWeightKg","countryOfOrigin"}}
 {"op":"remove_item","match":"sku or description words"}
 {"op":"update_item","match":"sku or description words","field":ITEMFIELD,"value":V,"mode":"set"|"increment"|"decrement"}
Rules: "boxes" are cartons, "skids" are pallets. Weights in kg (convert lbs and tonnes). Money is GBP only: ignore EUR/USD amounts. Dates are day-first; resolve relative dates against today. Never invent an HS code. destinationType is "Warehouse" or "Business address"; priority is Cheapest, Fastest, Most reliable or Balanced. Cities: origin London, Manchester, Birmingham, Leeds; destination Berlin, Frankfurt, Hamburg, Paris, Lyon, Amsterdam, Rotterdam. Only include fields the message actually states or changes. If there is nothing to update return {"updates":[]}.`;

export default async function handler(req: Req, res: Res): Promise<void> {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') return void res.status(405).json({ error: 'POST only' });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return void res.status(501).json({ error: 'LLM extraction is not configured' });

  const body = (typeof req.body === 'string' ? safeParse(req.body) : req.body) as { message?: unknown; booking?: unknown } | null;
  if (!body || typeof body.message !== 'string' || body.message.length > 1500) return void res.status(400).json({ error: 'bad request' });

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5500);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.LLM_MODEL || 'claude-haiku-5-5',
        max_tokens: 1024,
        temperature: 0,
        system: SYSTEM,
        messages: [{ role: 'user', content: JSON.stringify({ today: new Date().toISOString().slice(0, 10), message: body.message, currentBooking: body.booking ?? {} }) }],
      }),
      signal: ctl.signal,
    });
    if (!r.ok) return void res.status(502).json({ error: 'upstream error' });
    const data = (await r.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = data.content?.find((c) => c.type === 'text')?.text ?? '';
    const parsed = safeParse(text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
    if (!parsed) return void res.status(502).json({ error: 'model did not return JSON' });
    res.status(200).json(parsed);
  } catch {
    res.status(504).json({ error: 'timeout' });
  } finally {
    clearTimeout(timer);
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
