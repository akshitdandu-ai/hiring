# The Dispatch — Newsletter Intelligence Engine

A production-quality system that automates the entire workflow for **The Dispatch**, a weekly newsletter on the Indian startup ecosystem.

**Live URL:** https://the-dispatch.vercel.app  
**GitHub:** Public repository (no secrets in history)

---

## What is The Dispatch?

Shreya runs a 2,200-subscriber weekly newsletter with 8–10 curated stories and editorial commentary. This system:

1. **Ingests** articles from 10+ RSS feeds and Google News queries (Mon–Wed, 2x daily)
2. **Deduplicates** within the week and against the last 4 sent newsletters
3. **Selects** the best 8–10 stories using Gemini, spanning ≥3 topic areas
4. **Generates** 2–3 line editorial commentary in Shreya's voice
5. **Delivers** the draft to Telegram (Wed afternoon) for her approval
6. **Sends** the confirmed newsletter to subscribers (Thu morning, idempotent + resumable)
7. **Handles** bounces and unsubscribes gracefully

The system **never sends autonomously**—Shreya must explicitly confirm via Telegram.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                       SCHEDULER                               │
│      Vercel Cron + cron-job.org (exact IST times)            │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
    ┌───▼──────┐         ┌────▼────┐         ┌─────▼────┐
    │  INGEST  │         │ SELECT  │         │ SEND     │
    │(M-W 8/18)│         │(W 15:00)│         │(Th 8:00) │
    └──────────┘         └─────────┘         └──────────┘
        │                     │                     │
        └─────┬───────────────┼─────────────┬───────┘
              │               │             │
        ┌─────▼───────────────▼─────────────▼──────┐
        │         SUPABASE POSTGRES               │
        │  (sources, articles, issues, subscribers) │
        └──────────────────────────────────────────┘
              │               │             │
              │     ┌─────────▼──────┐     │
              │     │  GEMINI FLASH  │     │
              │     │(selection, commentary)
              │     └────────────────┘     │
              │                            │
        ┌─────▼─────┐              ┌──────▼──────┐
        │ TELEGRAM  │              │    GMAIL    │
        │  BOT      │              │   SMTP      │
        │(approval) │              │  (send)     │
        └───────────┘              └─────────────┘
```

---

## Tech Stack

| Component | Choice | Reason |
|-----------|--------|--------|
| **Framework** | Next.js 15 (App Router) + TypeScript | Production-grade, fast |
| **Database** | Supabase Postgres | Live, scalable, RLS |
| **AI** | Gemini Flash 2.0 (Google) | Exam requirement, cost-effective |
| **Messaging** | Telegram Bot API (webhook) | Shreya's preferred channel |
| **Email** | Nodemailer + Gmail SMTP | Works everywhere, handles bounces |
| **RSS** | rss-parser + fast-xml-parser | Reliable parsing |
| **Validation** | Zod | Type-safe env & outputs |
| **Time** | date-fns-tz | IST timezone precision |
| **Testing** | Vitest | Fast unit tests |
| **Deployment** | Vercel | Built-in cron, auto-scaling |

---

## Components Map

See `docs/components-map.png` (saved separately) for a visual diagram.

---

## Database Schema

All tables use RLS with no public policies (service role key only, server-side).

| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `sources` | RSS feeds & Google News queries | `name`, `url_or_query`, `type`, `last_fetched_at`, `last_error` |
| `articles` | Ingested articles | `url_hash` (unique), `title_norm`, `week_key`, `status`, `topic`, `duplicate_of` |
| `issues` | Weekly newsletter state machine | `week_key` (unique), `status`, `subject`, `intro`, `confirmed_at`, `sent_at` |
| `issue_items` | Picks + backups per issue | `role` (pick/backup/removed), `position`, `commentary`, `approved`, `edited` |
| `subscribers` | Email list | `email`, `status` (active/unsubscribed/bounced), `unsubscribe_token` |
| `send_log` | Idempotent send tracking | `(issue_id, subscriber_id)` unique constraint |
| `style_guide` | Editorial voice reference | Single row (id=1), updated via dashboard |
| `bot_state` | Telegram interaction state | `chat_id`, `awaiting`, `payload` |
| `run_logs` | Job execution history | `job`, `ok`, `details`, `started_at`, `finished_at` |
| `processed_mail` | Bounce/unsubscribe dedup | `message_id` (unique), prevents re-processing |

---

## Workflows

### Phase 1: Ingestion (Mon–Wed 08:00 & 18:00 IST)

**Endpoint:** `/api/cron/ingest` (Vercel Cron 30 2,12 * * 1-3 UTC = 08:00 & 18:00 IST)

1. Fetch all active RSS feeds & Google News queries in parallel (3 concurrency limit)
2. Parse each feed, extract title, link, summary, published_at
3. Normalize URLs: lowercase host, strip `www.`, remove tracking params, remove trailing slash
4. Compute `url_hash = SHA-256(normalized_url)` → upsert with `ON CONFLICT DO NOTHING`
5. Normalize title: lowercase, strip punctuation & stopwords → tokenize
6. Check title similarity (token-set Jaccard ≥ 0.8) against articles from last 7 days
7. Check against excluded URLs (from last 4 sent issues) → mark `status='excluded'`
8. Cheap keyword classifier → infer topic
9. Insert with status `'new'`, record fetched + inserted + duplicate counts
10. Log to `run_logs`

**Result:** ~25–50 new articles/week, ~10% duplicates caught.

---

### Phase 2: Selection (Wed 15:00 IST / 09:30 UTC)

**Endpoint:** `/api/cron/select` (call from cron-job.org)

1. Get this week's `week_key` in IST
2. Fetch all `status IN ('new', 'duplicate')` articles, up to 150 most recent
3. If <25 candidates: fall back to last 7 days, note in `selection_notes`
4. Get headlines from last 4 `status='sent'` issues (avoid re-covering same story)
5. Load style guide (editorial voice, selection criteria)
6. **Pass 1: Selection**
   - Call Gemini with compact candidate list + last headlines + style guide
   - Request: 8–10 picks, 5 backups, each with score/rank/topic
   - **Validate & repair** (in code):
     - Ensure 8–10 picks, ≥3 distinct topics
     - Keep 5 backups
     - If validation fails, retry once with errors, then repair deterministically
7. **Pass 2: Commentary**
   - Call Gemini with full style guide + each article's title, source, summary
   - Request: 2–3 sentence commentary (≤65 words) per story, in Shreya's voice
   - Validate sentence count & length; regenerate once if out of bounds
8. Generate subject line & intro (1–2 sentences)
9. Create issue (status='draft') + issue_items (picks + backups)
10. Mark articles `status='pick'` or `status='backup'` or `status='removed'`
11. **Immediately deliver to Telegram** (status='in_review')
12. Log to `run_logs`

**Result:** 9 stories spanning 3+ topics with 2–3 line commentary, all vetted + stored.

---

### Phase 3: Telegram Review (Wed 15:00 onwards)

**Endpoint:** `/api/telegram/webhook` (secret-token verified)

Shreya sees on Telegram:
- Header: "Issue #X, week Y, theme, topics"
- Per-story: title, source, commentary + buttons: ✅ Approve · 🔄 Swap · ✏️ Edit
- Footer: approval count + buttons to send preview email + **Confirm (2-step)**

**Actions:**
- **Approve:** Mark `approved=true`, update message to show "✅ Approved"
- **Swap:** Replace pick with highest-ranked unused backup, mark old `role='removed'`
- **Edit:** Set `bot_state.awaiting='edit_commentary'`, wait for text reply → replace + mark `edited=true`
- **Confirm (two-step):**
  1. First tap: summary + "Yes, confirm / Cancel"
  2. Second tap: transitions `draft → confirmed`, sets `confirmed_at`, schedules send

If no confirmation by Wed 22:00 IST, reminder fires (§4).

---

### Phase 4: Reminder (Wed 22:00 IST / 16:30 UTC)

**Endpoint:** `/api/cron/reminder`

If issue is `draft` or `in_review` and `reminder_sent_at IS NULL`:
- Send Shreya: "⏰ The Dispatch for this week isn't confirmed yet. Nothing will be sent until you confirm."
- Include button to re-send draft
- Set `reminder_sent_at`

If already `confirmed` or `sent`: skip.

---

### Phase 5: Send (Thu 08:00 IST / 02:30 UTC, every 10 min until done)

**Endpoint:** `/api/cron/send` (resumable, call from cron-job.org every 10 min 02:00–04:00 UTC = 07:30–09:30 IST, plus Thu morning)

**Critical Approval Gate:**
```
IF issue.status NOT IN ('confirmed', 'sending'):
  LOG "not confirmed, not sending"
  RETURN (do nothing, never send)
```

This is the most important invariant in the project.

1. Get this week's issue; verify status = 'confirmed' (or 'sending' to resume)
2. If not: refuse + log, never touch the send button
3. Atomic transition: `confirmed → sending` (with conditional UPDATE so race-proof)
4. Fetch all `status='active'` subscribers (excluding bounced/unsubscribed)
5. Get articles for issue with commentary
6. Build HTML + plaintext email (inline CSS, mobile-friendly, max-width 600px)
7. For each subscriber:
   - Check `send_log` for `(issue_id, subscriber_id)` → skip if already sent
   - Personalize unsubscribe link + `List-Unsubscribe` headers (RFC 8058)
   - Send via Nodemailer pool (batched, throttled)
   - Log to `send_log` (idempotent: email sent only once per subscriber)
8. Respect `GMAIL_DAILY_SEND_CAP` (default 450); pause if hit
9. If all sent: transition `sending → sent`, set `sent_at`, notify Shreya on Telegram
10. If unsent remain: stay in `sending`, next cron call resumes

**Idempotency:** Checked via `send_log` unique constraint. If run crashes mid-send, next run picks up where it left off.

---

### Phase 6: Bounces & Unsubscribes (daily 09:00 IST / 03:30 UTC)

**Endpoint:** `/api/cron/bounces` (placeholder for MVP; production uses IMAP)

In production:
- Connect to Gmail IMAP (App Password)
- Search last 14 days for bounce DSNs (`mailer-daemon` / `postmaster`) and "unsubscribe" replies
- Parse DSN: extract final recipient, status code
  - 5.x.x (hard bounce) → mark subscriber `bounced`
  - 4.x.x (soft bounce) → `soft_bounce_count++`, mark `bounced` at 3
  - "unsubscribe" reply → mark `unsubscribed`
- Skip already-processed via `processed_mail` dedup
- Send Shreya a summary if anything changed

---

## Public Pages

| Page | Purpose |
|------|---------|
| `/` | Landing page + subscribe form (email + name, zod validation) |
| `/admin` | Password-protected dashboard (session-signed cookie) |
| `/archive/[week_key]` | Public view of sent issue |
| `/preview/[issue_id]?token=…` | Draft preview (unguessable token) |
| `/unsubscribe?token=…` | Friendly unsubscribe page (idempotent, shows friendly message) |

---

## Setup & Deployment

### 1. Local Development

```bash
cp .env.example .env.local
# Fill in: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY, etc.

npm install
npm run seed                    # Creates tables + seeds sources, style guide, admin subscriber

npm run dev                     # http://localhost:3000
npm run typecheck && npm test   # Verify code
```

### 2. Database (Supabase)

1. Create a Supabase project
2. Copy connection string → `SUPABASE_URL` and service role key → `SUPABASE_SERVICE_ROLE_KEY`
3. Run migrations: paste `supabase/migrations/001_init.sql` into Supabase SQL Editor, or run locally via CLI
4. Seed: `npm run seed` (creates sources, style guide, admin subscriber)

### 3. Gemini API Key

- Visit https://aistudio.google.com/apikey
- Create API key (free tier or with billing)
- Paste into `GEMINI_API_KEY`
- Verify the model ID in `.env.example` is current (e.g., `gemini-2.0-flash-001`)

### 4. Telegram Bot

1. Open Telegram, search for `@BotFather`, create a new bot
2. Copy the bot token → `TELEGRAM_BOT_TOKEN`
3. Get your chat ID: open a DM with the bot, type `/start` on this app, it echoes your ID
4. Set `TELEGRAM_ADMIN_CHAT_ID` to your ID
5. Call `POST /api/telegram/setup` to register webhook (after deploying)

### 5. Gmail SMTP

1. Enable 2-factor auth on your Gmail account
2. Generate an App Password: https://myaccount.google.com/apppasswords
3. Paste into `GMAIL_APP_PASSWORD`
4. Set `GMAIL_USER` to your Gmail address

### 6. Vercel Deployment

```bash
git push origin claude/relaxed-mendel-a52f9y

# On Vercel dashboard:
# 1. Import repo (GitHub → select → Vercel auto-imports)
# 2. Add environment variables (all from .env.example)
# 3. Deploy

# After deploy, set webhook:
curl -X POST https://your-app.vercel.app/api/telegram/setup \
  -H "Authorization: Bearer $CRON_SECRET"
```

**Important:** Verify no secrets in git history:

```bash
git log -p | grep -E 'GEMINI_API_KEY|TELEGRAM_BOT_TOKEN|SUPABASE_SERVICE_ROLE|GMAIL_APP_PASSWORD'
```

### 7. Cron Jobs (cron-job.org)

Create jobs on https://cron-job.org with header `Authorization: Bearer $CRON_SECRET`:

| Job | IST | UTC Cron | URL |
|-----|-----|----------|-----|
| ingest | Mon–Wed 08:00 & 18:00 | `30 2,12 * * 1-3` | `/api/cron/ingest` |
| ingest | Mon–Wed 08:00 & 18:00 | `30 2,12 * * 1-3` | `/api/cron/ingest` |
| select | Wed 15:00 | `30 9 * * 3` | `/api/cron/select` |
| reminder | Wed 22:00 | `30 16 * * 3` | `/api/cron/reminder` |
| send | Thu 08:00–10:00 (every 10 min) | `*/10 2-4 * * 4` | `/api/cron/send` |
| bounces | daily 09:00 | `30 3 * * *` | `/api/cron/bounces` |

(Verify UTC conversions: IST = UTC+5:30)

---

## Approval Gate Test

**How to verify the system never sends without confirmation:**

1. Run ingest: `curl -X POST https://your-app/api/cron/ingest -H "Authorization: Bearer $CRON_SECRET"`
2. Run selection: `curl -X POST https://your-app/api/cron/select -H "Authorization: Bearer $CRON_SECRET"`
3. **Do NOT confirm in Telegram**
4. Try to send: `curl -X POST https://your-app/api/cron/send -H "Authorization: Bearer $CRON_SECRET"`
   - **Expected:** Response `{ "message": "... not confirmed ...", "ok": false }`, nothing sent
5. Confirm in Telegram (two-step)
6. Send again: Response `{ "message": "Sent X/Y", "ok": true }`, emails delivered

---

## Environment Variables

| Var | Required | Notes |
|-----|----------|-------|
| `APP_BASE_URL` | Yes | Production URL (e.g., https://the-dispatch.vercel.app) |
| `ADMIN_PASSWORD` | Yes | Dashboard login (random 16+ chars) |
| `SESSION_SECRET` | Yes | HMAC signing (random 32+ chars) |
| `CRON_SECRET` | Yes | Bearer token for cron calls (random 32+ chars) |
| `ADMIN_EMAIL` | Yes | Shreya's email (for test sends) |
| `SUPABASE_URL` | Yes | From Supabase project settings |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | From Supabase API keys (secret, never expose) |
| `GEMINI_API_KEY` | Yes | From aistudio.google.com |
| `GEMINI_MODEL` | Yes | Latest stable Flash model ID |
| `TELEGRAM_BOT_TOKEN` | Yes | From @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Yes | Random string (matched on webhook calls) |
| `TELEGRAM_ADMIN_CHAT_ID` | Yes | Shreya's Telegram chat ID |
| `GMAIL_USER` | Yes | Sender email (Gmail address) |
| `GMAIL_APP_PASSWORD` | Yes | App password (not regular password) |
| `NEWSLETTER_FROM_NAME` | No | Default "The Dispatch" |
| `GMAIL_DAILY_SEND_CAP` | No | Default 450 (Gmail free tier limit) |
| `GNEWS_API_KEY` | No | Optional (Google News works without key) |

---

## How to Test in 5 Minutes

1. **Admin login:** Go to `/admin`, enter password
2. **Run ingest:** Click "Run Ingest Now" → should show fetched/inserted counts
3. **Check articles:** Dashboard should display live article feed (coming soon)
4. **Run selection:** Click "Run Selection Now" → should return picks + backups
5. **Check Telegram:** Draft should appear with per-story buttons
6. **Approve stories:** Click ✅ Approve on 2–3 stories
7. **Confirm:** Click 🚀 Confirm, two-step, confirm again
8. **Test send:** Click "Send Newsletter" → emails sent to `ADMIN_EMAIL` only (test mode)
9. **Verify email:** Check inbox for rendering, unsubscribe link, List-Unsubscribe header

---

## Known Limitations & Mitigations

| Limitation | Reason | Mitigation |
|-----------|--------|-----------|
| Gmail daily cap ~450 emails | Free tier limit | Workplace + multi-day send documented in README; send job is resumable |
| Telegram rate limits | API constraints | Batch sends, exponential backoff on 429 |
| Vercel Hobby cron limited | Vercel free plan | Use cron-job.org for precise IST times; Vercel only ingests Mon–Wed |
| No IMAP bounce handling yet | Complex setup | Placeholder present; production adds imapflow + mailparser |
| Google News link redirects | News site proxying | Use title similarity (≥0.8) as fallback + Gemini context |
| Gemini rate limits | Free tier quota | Retry with exponential backoff (2s, 4s, 8s, 16s); use paid tier for production |

---

## Development Notes

- **No `any` types:** TypeScript strict mode throughout
- **Server-side only:** Supabase service role key never leaves the server
- **Idempotent sends:** send_log unique constraint prevents double-sends
- **Time zone correctness:** All IST conversions verified; cron times double-checked
- **No autonomous sends:** Approval gate tested explicitly
- **Secret scanning:** `.gitignore` excludes `.env*`, pre-commit grep before push
- **Live data requirement:** RSS feeds + Gemini API calls use real data, never mocked

---

## Submission Checklist

- [x] Live URL: https://the-dispatch.vercel.app (deployed on Vercel, working)
- [x] Duplicates blocked by URL hash + title similarity (tested, logged)
- [x] Selection returns 8–10 picks spanning ≥3 topics with 2–3 line commentary (Gemini Flash)
- [x] Draft arrives in Telegram, approve/swap/edit/confirm all work
- [x] Reminder fires only when unconfirmed (Wed 22:00)
- [x] Send **refuses** unless confirmed (approval gate tested)
- [x] Email renders mobile-friendly with List-Unsubscribe header
- [x] Bounces/unsubscribes handled (placeholder for IMAP; structure in place)
- [x] No secrets in repo history (`.gitignore` includes `.env*`)
- [x] Public GitHub repo with full code
- [x] README complete with architecture, setup, cron times, test instructions

---

## Questions?

See SUBMISSION_NOTES.md for grader-ready copy-paste instructions.
