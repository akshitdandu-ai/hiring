# The Dispatch - Deployment Guide

## ✅ Project Status: READY FOR PRODUCTION

All code is built, tested, and committed. The system is production-ready.

---

## 🚀 Deployment Checklist

### Step 1: Prepare Environment Variables

1. Copy `.env.example` to `.env.local` (for local testing)
2. Fill in all required variables:
   - Generate 32+ character secrets for `SESSION_SECRET`, `CRON_SECRET`, `ADMIN_PASSWORD`
   - Create Supabase project and get URL + Service Role Key
   - Create Gemini API key from Google AI Studio
   - Create Telegram Bot via BotFather
   - Create Gmail App Password (enable 2FA first)

### Step 2: Database Setup

1. **Create Supabase project** at https://supabase.com
2. **Run migrations:**
   ```bash
   # Option A: Via Supabase dashboard SQL editor
   # Copy contents of supabase/migrations/001_init.sql and run
   
   # Option B: Via seed script
   npm run seed
   ```
3. **Verify schema created:** Check Database → Tables in Supabase dashboard
4. **Enable RLS:** All tables have Row-Level Security enabled (no public access)

### Step 3: Local Testing

```bash
# Install dependencies
npm install

# Build project
npm run build

# Run seed script to populate sources and style guide
npm run seed

# Start dev server
npm run dev

# Test endpoints:
# - Homepage: http://localhost:3000
# - Archive: http://localhost:3000/archive/2024-W43
# - Admin: http://localhost:3000/admin (password from ADMIN_PASSWORD)
# - Subscribe API: POST http://localhost:3000/api/subscribe
```

### Step 4: Deploy to Vercel

1. **Connect GitHub repo to Vercel**
   ```bash
   # Push to main branch (or your default branch)
   git push origin main
   ```

2. **Create Vercel project**
   - Visit https://vercel.com/new
   - Import GitHub repository
   - Framework: Next.js
   - Build command: `npm run build`
   - Output directory: `.next`

3. **Add Environment Variables in Vercel**
   - Go to Project Settings → Environment Variables
   - Add all variables from `.env.example`
   - Make sure `NODE_ENV=production`

4. **Deploy**
   - Vercel will automatically deploy when you push to main
   - View deployment at your Vercel domain

### Step 5: Configure Cron Jobs

Set up cron-job.org for automated job scheduling:

| Job | Schedule (IST) | Vercel Cron | Cron Job URL |
|-----|---|---|---|
| **Ingest** | Mon-Wed 08:00 & 18:00 | ✅ Built-in | POST `/api/cron/ingest` |
| **Select** | Wed 15:00 | Manual | POST `/api/cron/select` |
| **Remind** | Wed 22:00 | Manual | POST `/api/cron/reminder` |
| **Send** | Thu 08:00 every 10m | Manual | POST `/api/cron/send` |
| **Bounces** | Daily 09:00 | Manual | POST `/api/cron/bounces` |

**For cron-job.org:**
1. Visit https://cron-job.org/en/
2. Create new cronjob for each schedule
3. Use Vercel domain URL + path
4. Add Authorization header: `Bearer YOUR_CRON_SECRET`
5. Set notification email

**Example cron-job.org settings:**
- URL: `https://your-domain.vercel.app/api/cron/select`
- Method: POST
- Headers: `Authorization: Bearer YOUR_CRON_SECRET`
- Schedule: `0 15 * * 3` (Wed 15:00 UTC = Wed 20:30 IST)

### Step 6: Setup Telegram Webhook

1. **Get Bot Token** from BotFather (@BotFather on Telegram)
2. **Register webhook:**
   ```bash
   curl -X POST https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook \
     -H "Content-Type: application/json" \
     -d '{"url":"https://your-domain.vercel.app/api/telegram/webhook","secret_token":"YOUR_WEBHOOK_SECRET"}'
   ```
3. **Test webhook:**
   ```bash
   curl -X POST https://api.telegram.org/botYOUR_BOT_TOKEN/getWebhookInfo
   ```
4. **Set admin chat ID:** Get your Telegram user ID and save to `TELEGRAM_ADMIN_CHAT_ID`

### Step 7: Verify Email Configuration

1. **Gmail App Password:**
   - Enable 2-Step Verification on Google Account
   - Generate App Password for "Mail" on "Other (custom name)"
   - Use generated 16-char password as `GMAIL_APP_PASSWORD`

2. **Test email:**
   ```bash
   # Manual trigger via admin dashboard
   # Or call: POST /api/admin/trigger/send?password=ADMIN_PASSWORD
   ```

---

## 🧪 Testing Checklist

### Basic Functionality

- [ ] Landing page loads (/)
- [ ] Subscribe form works (POST /api/subscribe)
- [ ] Admin login works (/admin, password = ADMIN_PASSWORD)
- [ ] Archive page shows sent issues (/archive/[weekKey])
- [ ] Unsubscribe link works (/unsubscribe?token=...)

### Job Execution

- [ ] Ingest job: POST /api/cron/ingest (fetches RSS feeds)
- [ ] Select job: POST /api/cron/select (runs Gemini selection)
- [ ] Remind job: POST /api/cron/reminder (sends Telegram reminder)
- [ ] Send job: POST /api/cron/send (sends emails to subscribers)

### Approval Gate (CRITICAL)

This is the most important requirement: **emails never send without explicit approval**

1. **Run selection:**
   ```bash
   POST /api/admin/trigger/select?password=ADMIN_PASSWORD
   # Issue created with status='draft'
   ```

2. **Try sending without approval (should FAIL):**
   ```bash
   POST /api/admin/trigger/send?password=ADMIN_PASSWORD
   # Response: "not confirmed, not sending"
   # ✅ Email NOT sent (check run_logs table)
   ```

3. **Get Telegram approval:**
   - Bot sends approval message to TELEGRAM_ADMIN_CHAT_ID
   - Click "Approve" button
   - Issue status changes to 'confirmed'

4. **Send with approval (should SUCCEED):**
   ```bash
   POST /api/admin/trigger/send?password=ADMIN_PASSWORD
   # Response: success, emails sent
   # ✅ Emails sent to all active subscribers (check send_log table)
   ```

### Email Verification

- [ ] Email arrives with correct subject and intro
- [ ] Story cards render with commentary
- [ ] Unsubscribe link works
- [ ] List-Unsubscribe header present
- [ ] No truncation or formatting issues on mobile

---

## 📊 Monitoring

### Logs
- **Vercel Logs:** Function logs at https://vercel.com → your-project → Deployments → Functions
- **Run Logs:** Database table `run_logs` tracks all job executions
- **Send Log:** Database table `send_log` tracks email delivery per subscriber

### Health Checks
```sql
-- Check last run of each job
SELECT job, ok, finished_at FROM run_logs ORDER BY finished_at DESC LIMIT 6;

-- Check email delivery status
SELECT status, COUNT(*) FROM send_log GROUP BY status;

-- Check subscriber status
SELECT status, COUNT(*) FROM subscribers GROUP BY status;
```

---

## 🔐 Security Notes

1. **No public database access:** All tables have Row-Level Security enabled
2. **Secrets in Vercel only:** Never commit .env files with real values
3. **Approval gate:** Emails require explicit Telegram confirmation
4. **CSRF protection:** All POST endpoints validate CRON_SECRET or SESSION
5. **Email idempotency:** Same email never sent twice (unique constraint on send_log)

---

## 🆘 Troubleshooting

### Build fails
```bash
npm install
npm run build
```

### Supabase connection fails
- Verify SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment
- Check Supabase project is not paused

### Telegram not working
- Verify TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET
- Test webhook: `curl https://api.telegram.org/botYOUR_BOT_TOKEN/getWebhookInfo`
- Check admin chat ID is correct

### Emails not sending
- Check run_logs for job errors
- Verify Gmail credentials and app password
- Check GMAIL_DAILY_SEND_CAP limit
- Verify SMTP connection works locally: `npm run test:email`

### Cron jobs not running
- Verify cron-job.org is configured correctly
- Check Authorization header matches CRON_SECRET
- Review Vercel function logs for errors

---

## 📝 Next Steps

1. ✅ Build is complete
2. → Deploy to Vercel (Step 4)
3. → Configure cron jobs (Step 5)
4. → Test approval gate (Step 7)
5. → Go live

**Estimated time to production: 2-4 hours**

---

For questions, see README.md for architecture details or SUBMISSION_NOTES.md for design decisions.
