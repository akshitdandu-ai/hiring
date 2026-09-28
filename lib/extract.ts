// CV file -> text, then split personal details (name, email, phone, profile links) from the rest.
// This runs in plain code on our server: personal details never reach any AI call.
import type { PersonalDetails } from './db';

export async function fileToText(fileName: string, buf: Buffer): Promise<string> {
  const ext = fileName.toLowerCase().split('.').pop() || '';
  let text: string;
  if (ext === 'pdf' || buf.subarray(0, 5).toString() === '%PDF-') {
    const { getDocumentProxy, extractText } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const res = await extractText(pdf, { mergePages: true });
    text = res.text as string;
  } else if (ext === 'docx') {
    const mammoth = await import('mammoth');
    text = (await mammoth.extractRawText({ buffer: buf })).value;
  } else if (['txt', 'md', 'text', 'rtf', 'csv'].includes(ext)) {
    text = buf.toString('utf8');
    if (ext === 'rtf') text = stripRtf(text);
  } else if (ext === 'doc') {
    throw new Error('Legacy .doc files are not supported - save as .docx or PDF and upload again.');
  } else {
    throw new Error(`Unsupported file type ".${ext}". Upload PDF, DOCX or TXT.`);
  }
  text = text.replace(/\r\n?/g, '\n').replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < 80) {
    throw new Error('Could not read any text from this file (is it a scanned image?).');
  }
  return text;
}

function stripRtf(rtf: string) {
  return rtf
    .replace(/\\par[d]?/g, '\n')
    .replace(/\{\*?\\[^{}]+}|[{}]|\\\n?[A-Za-z]+\n?(?:-?\d+)?[ ]?/g, '')
    .trim();
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Broad phone matcher; candidates are then filtered to 10-13 digits so year ranges etc. don't match.
const PHONE_RE = /(?:\+\s?\d{1,3}[\s.-]?)?(?:\(\d{2,5}\)[\s.-]?)?\d[\d\s.-]{7,15}\d/g;
const LINK_RE =
  /(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com|github\.com|gitlab\.com|leetcode\.com|twitter\.com|x\.com|medium\.com|behance\.net|dribbble\.com|about\.me|[a-z0-9-]+\.(?:vercel\.app|netlify\.app|github\.io))(?:\/[^\s|·•,;)]*)?/gi;

const NOT_NAME_WORDS = new Set(
  `resume curriculum vitae cv profile summary professional experience education skills certifications
  tools contact details objective about me personal information product manager senior junior lead head
  sales enterprise marketing growth leader engineer engineering operations customer success executive analyst
  consultant developer designer director officer associate specialist logistics supply chain b2b saas
  software backend frontend team builder demand generation work history projects achievements languages
  references mumbai bengaluru bangalore chennai delhi pune hyderabad india maharashtra karnataka new
  private limited pvt ltd technologies solutions services freight`
    .split(/\s+/)
    .filter(Boolean),
);

function titleCase(s: string) {
  return s.replace(/\b([A-Za-z])([A-Za-z'.-]*)/g, (_, a: string, b: string) => a.toUpperCase() + b.toLowerCase());
}

function nameCandidate(line: string): string | null {
  const first = line.split(/\s*(?:\||·|•|–|—|,|\s-\s|\t)\s*/)[0].trim();
  const labelled = first.match(/^(?:full\s+)?name\s*[:\-]\s*(.+)$/i);
  const cand = (labelled ? labelled[1] : first).replace(/\s+/g, ' ').trim();
  if (cand.length < 4 || cand.length > 40) return null;
  const tokens = cand.split(' ');
  if (tokens.length < 2 || tokens.length > 4) return null;
  if (!tokens.every((t) => /^[A-Za-z][A-Za-z'.-]*$/.test(t))) return null;
  if (tokens.some((t) => NOT_NAME_WORDS.has(t.toLowerCase().replace(/\.$/, '')))) return null;
  return cand;
}

export function findName(text: string, email?: string): string | undefined {
  const labelled = text.match(/^\s*(?:full\s+)?name\s*[:\-]\s*([A-Za-z][A-Za-z .'-]{2,40})$/im);
  if (labelled) return titleCase(labelled[1].trim());

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const emailIdx = email ? lines.findIndex((l) => l.includes(email)) : -1;
  const local = (email || '').split('@')[0].toLowerCase();
  let best: { name: string; score: number } | undefined;

  lines.forEach((line, i) => {
    const nearTop = i < 6;
    const nearEmail = emailIdx >= 0 && Math.abs(i - emailIdx) <= 3;
    if (!nearTop && !nearEmail) return;
    const name = nameCandidate(line);
    if (!name) return;
    let score = 0;
    const toks = name.toLowerCase().split(' ').map((t) => t.replace(/[^a-z]/g, ''));
    const overlap = toks.filter((t) => t.length >= 3 && local.includes(t)).length;
    score += overlap * 3;
    if (i < 3) score += 2;
    if (nearEmail) score += 1;
    if (line.trim() === name) score += 1;
    if (!best || score > best.score) best = { name, score };
  });
  if (!best) return undefined;
  return best.name === best.name.toUpperCase() ? titleCase(best.name) : best.name;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function splitPersonalDetails(text: string): { personal: PersonalDetails; redacted: string } {
  const emails = [...new Set(text.match(EMAIL_RE) || [])];
  const phones = [...new Set((text.match(PHONE_RE) || []).map((p) => p.trim()))].filter((p) => {
    const digits = p.replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 13 && !/^(19|20)\d{2}[\s.-]*(19|20)\d{2}$/.test(p);
  });
  const links = [...new Set(text.match(LINK_RE) || [])].filter((l) => !l.includes('@'));
  const name = findName(text, emails[0]);

  let redacted = text;
  for (const e of emails) redacted = redacted.split(e).join('[EMAIL]');
  for (const p of phones.sort((a, b) => b.length - a.length)) redacted = redacted.split(p).join('[PHONE]');
  for (const l of links.sort((a, b) => b.length - a.length)) redacted = redacted.split(l).join('[LINK]');
  if (name) {
    redacted = redacted.replace(new RegExp(`\\b${escapeRe(name)}\\b`, 'gi'), '[CANDIDATE]');
    for (const part of name.split(' ').filter((p) => p.replace(/\./g, '').length >= 3)) {
      // Possessives and bare first/last names later in the CV ("Rohan's", "Ms. Iyer").
      redacted = redacted.replace(new RegExp(`\\b${escapeRe(part)}\\b`, 'gi'), '[CANDIDATE]');
    }
    redacted = redacted.replace(/\[CANDIDATE\](\s+\[CANDIDATE\])+/g, '[CANDIDATE]');
  }

  return {
    personal: {
      name,
      email: emails[0],
      phone: phones[0],
      links: links.length ? links : undefined,
    },
    redacted,
  };
}
