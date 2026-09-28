# Kargo Hiring Dashboard

An internal tool for Arjun (founder, Kargo) to turn a pile of PM / SPM CVs into a ranked shortlist he can trust, with a
brief and draft email for every candidate, sent in one click. **The system recommends. Arjun decides.**

```
Founder uploads CV + picks role ─▶ Extract text, split off personal details ─▶ Score vs PM AND SPM rubric
     (PDF / DOCX / TXT)              (name, email, phone, links stay in DB;      (Gemini, 1-5 per criterion
                                      only redacted CV goes to AI)                 + one-line reason, weighted /100)
                                                                                          │
Dashboard: ranked per role, score breakdown,  ◀── Rank within applied role ◀──────────────┘
brief, draft email, one-click send (Resend)        Top 5 with score ≥ 60 → 3-sentence brief + interview invite
                                                   Everyone else          → warm, specific rejection
                                                   Real name substituted only at display / send time
```

## Pages

| Page         | What it does |
|--------------|--------------|
| `/`          | Pick the role applied for, drop in CVs (many at once). Each one is parsed, redacted, stored and scored; then briefs and drafts are written automatically. |
| `/dashboard` | PM / SPM tabs. Candidates ranked by score, split into *Interview* and *Below the line*. Open a card for the brief, per-criterion scores and reasons (for both rubrics), private contact details and the editable draft. Buttons: **Send**, *Reject/Interview instead* (override - draft is rewritten), *Rewrite draft*, *Move to other role*, *Rescore*, *Delete*, and **Send all rejection drafts** per role. |
| `/rubric`    | The rubric exactly as stored in the `rubric_criteria` table. |

A "Stronger fit for SPM/PM" badge appears when a candidate clears the bar on the rubric for the role they did *not* apply for.

## Setup

You need three keys: a Postgres database (Supabase / Neon / any), a Gemini API key, and (for sending) a Resend API key.

1. **Database** - Supabase: *Project Settings → Database → Connection string → Transaction pooler* (port 6543), with
   your database password filled in. Neon: the pooled connection string. Nothing to run by hand: on the first request the
   app creates the tables and loads `rubric.txt` into `rubric_criteria` (10 rows: 5 per role).
2. **Gemini** - create a key at https://aistudio.google.com/apikey.
3. **Resend** - create a key at https://resend.com (can be left blank until checkpoint B-2). Without a verified domain
   Resend only lets you send *from* `onboarding@resend.dev`, which is the default.

```bash
cp .env.example .env.local      # fill in DATABASE_URL, GEMINI_API_KEY (RESEND_API_KEY later)
npm install
npm run dev                     # http://localhost:3000
npm test                        # unit tests: rubric parsing, PII split, ranking, scoring maths
```

### Deploy on Vercel

1. Push to GitHub, then *Vercel → Add New → Project → import this repo* (framework: Next.js, no settings to change).
2. Add the environment variables from `.env.example` (at minimum `DATABASE_URL`, `GEMINI_API_KEY`; add
   `RESEND_API_KEY` for sending and `DASHBOARD_PASSWORD` to protect the site) and deploy.
3. After changing any variable in Vercel, redeploy.

### Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string. SSL is used automatically for non-local hosts. |
| `GEMINI_API_KEY` | yes | All AI steps. `GEMINI_MODEL` overrides the model (default `gemini-2.5-flash`). |
| `RESEND_API_KEY` | to send | Send button is disabled with a notice until set. |
| `EMAIL_FROM` | no | Default `Kargo Hiring <onboarding@resend.dev>`. `EMAIL_REPLY_TO` optional. |
| `EMAIL_ALLOWED_DOMAINS` | no | Comma-separated; refuses to send to any other domain (e.g. the MESA test domain). |
| `EMAIL_TEST_RECIPIENT` | no | Sends every email to this one address instead of the candidate. |
| `DASHBOARD_PASSWORD` | recommended | HTTP basic auth on every page and API route (any username). |
| `TOP_N_PER_ROLE`, `INVITE_THRESHOLD` | no | Interview line: top 5 per role that also score ≥ 60/100. |
| `FOUNDER_NAME`, `COMPANY_NAME` | no | Used in email sign-offs (defaults Arjun Mehta / Kargo). |

## How it works

- **Extraction (no AI).** `lib/extract.ts` reads PDF (unpdf), DOCX (mammoth) or text, finds the email, phone, profile links
  and name (header lines, cross-checked against the email address) and replaces them everywhere in the CV with
  `[CANDIDATE]`, `[EMAIL]`, `[PHONE]`, `[LINK]`. Personal details go to `candidates.personal_details`; only the redacted
  text is stored in `candidates.cv_text` and sent to Gemini. The execution plan suggested Gemini for this step, but
  that would send the very data we are protecting to the AI, so it is done in plain code instead. If a name isn't
  found, the card says so and you can add it with *Edit details*.
- **Scoring.** One Gemini call per CV with a strict JSON schema scores every criterion of **both** rubrics 1-5 with a
  one-line, evidence-based reason, following the rubric's "how to score" and "do not reward" rules (temperature 0).
  The weighted score (`sum(score / 5 × weight)`, max 100) is computed in code, not by the model. Scores live in the
  `scores` table (one row per criterion per role); totals in `candidates.pm_score` / `spm_score`.
- **Ranking + drafts.** Candidates are ranked within the role they applied for. Top N above the threshold get a
  3-sentence interview brief (who they are / why ranked here / what to probe) and an invite; everyone else gets a warm,
  specific rejection. Drafts use a `[NAME]` placeholder that is swapped for the real first name only when displayed or
  sent. When new uploads shift the line, affected drafts are rewritten automatically (never ones already sent).
- **Pipeline.** Work runs one unit per request (`POST /api/pipeline`) with row claiming, so each serverless call stays
  short, parallel workers never double-process, and Gemini rate limits (429s) are retried with backoff. The upload page
  and dashboard drive it until nothing is left; if you close the tab, the dashboard resumes it on next load.
- **Sending.** `POST /api/candidates/:id/send` atomically claims the send (no double sends), calls Resend with an
  idempotency key, and records `email_status = 'sent'`, `sent_at`, `sent_to` and the Resend id.

### Data model

- `rubric_criteria` - id, role (PM/SPM), position, name, weight, anchor_5 / anchor_3 / anchor_1, source.
- `rubric_guidance` - "how to score", hire patterns and "do not reward" text from `rubric.txt`.
- `candidates` - applied role, `personal_details` (jsonb, private), `cv_text` (redacted), scores, headline, brief,
  draft (subject/body/decision), founder override, send status.
- `scores` - candidate × criterion: score 1-5 + reason.

RLS is enabled on all tables with no policies, so nothing is readable through Supabase's public anon API; the app
connects directly as the database owner.

To change the rubric: edit `rubric.txt`, then `npm run rubric` (regenerates `lib/rubric.generated.json`) and
`npm run db:setup` (updates the rows in the database), and *Rescore* candidates as needed.

## Data privacy notes

- **Gemini free tier vs paid.** On the free tier (AI Studio key without billing) Google may use prompts and responses
  to improve its products, and humans may review them. With billing enabled (paid tier) that data is not used to
  improve Google's products. Real candidate data should only go through the paid tier.
- **Why the extraction step matters for DPDP.** Separating identifiers before any AI call is data minimisation:
  the third-party processor only receives what is needed to assess the work history, never the name, email, phone or
  profile links. In production you would add a stated purpose and notice to applicants, retention limits (delete
  rejected candidates' data after a set period - the *Delete* button removes everything), access control (set
  `DASHBOARD_PASSWORD` or real auth), and a processor agreement with the AI vendor.
- Scoring only uses what is written in the CV; the prompt tells the model to ignore titles, employer brand, college,
  certifications and years of experience, per the rubric.
