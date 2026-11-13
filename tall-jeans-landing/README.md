# [BRAND NAME] – deposit landing page

One static page, one goal: ₹500 refundable deposits (plus free waitlist sign-ups to compare against).
No build step, no framework. Deploy this folder as-is (Vercel/Netlify/Cloudflare Pages: set the root directory to `tall-jeans-landing`).

```
index.html          the page (inline CSS + JS, ~40 KB)
privacy.html        draft Privacy Policy
refund.html         draft Refund Policy
policy.css          styles for the two policy pages
apps-script/Code.gs Google Sheet collector
```

Preview locally: `python3 -m http.server 8000` in this folder.

## 1. Fill the placeholders

Find them all: `grep -n '\[[A-Z]' index.html privacy.html refund.html`

| Placeholder | Where |
|---|---|
| `[BRAND NAME]`, `[DOMAIN]` | everywhere (title, meta, header, footer, policies) |
| `[INSTAGRAM HANDLE]`, `[WHATSAPP NUMBER]`, `[EMAIL]` | footer, policies (WhatsApp as `919876543210` in the `wa.me` link) |
| `[DELIVERY WEEKS]` | deposit steps, FAQ |
| `[FOUNDER NAME]`, `[FOUNDER HEIGHT]`, `[ONE LINE ON WHY YOU STARTED]` | founder section (draft copy: make it true) |
| `[FIT GUARANTEE…]`, `[SHIPPING TERMS]` | FAQ |
| `CONFIG` block at the top of the `<script>` | `SHEET_ENDPOINT`, `PAYMENT_LINK`, `WHATSAPP_GROUP_LINK`, `GOOGLE_ADS_ID` + labels, `META_PIXEL_ID` |

Anything in `CONFIG` still in `[brackets]` is skipped. The page runs while you wire things up and logs what it *would* send to the browser console.

Photos: each grey dashed box is a `<div class="ph">`. Replace it with
`<img src="…" alt="…" width="800" height="1000" loading="lazy" decoding="async" style="width:100%;height:auto">`
(keep the hero image eager, no `loading="lazy"`). Export WebP/AVIF at ≤ 120 KB each.

## 2. Google Sheet (data collection)

1. Create a Google Sheet. **Extensions → Apps Script**, paste `apps-script/Code.gs`, save.
2. **Deploy → New deployment → Web app**. Execute as: *Me*. Who has access: *Anyone*. Copy the `/exec` URL into `CONFIG.SHEET_ENDPOINT`.
3. Re-deploy (new version) any time you edit `Code.gs`.

Tabs are created automatically:
- **Submissions**: timestamp (IST), submission_id, `choice` (`deposit` / `waitlist`), name, whatsapp, email, city, height, waist, inseam, fit, problem, utm_source/medium/campaign/content/term, gclid, fbclid, referrer, landing_url.
- **Events**: `fit_pick` clicks (and `deposit_paid` if you use the callback below).

Fit clicks per fit: `=COUNTIFS(Events!B:B,"fit_pick",Events!C:C,"Slim")`.

**Important:** `choice = deposit` means the person *clicked through to pay*, not that they paid. Match against your Razorpay/UPI dashboard by WhatsApp number to get real deposits. The paid-vs-free comparison should use the dashboard as the source of truth.

Submissions are fire-and-forget (`no-cors`), so the browser can't see a failed save. Test once end-to-end after deploying, and check the sheet daily at first.

## 3. Payment link and thank-you

Set `PAYMENT_LINK` to your Razorpay payment link (₹500). Set its **callback URL** to `https://[DOMAIN]/?paid=1`. People are then returned to a "Deposit received" screen with the WhatsApp community button. The page also logs a `deposit_paid` event, but UPI-app hand-offs can skip the callback, so don't count on it for revenue.

## 4. Tracking events

| Event | Fires when | Meta | Google Ads |
|---|---|---|---|
| `cta_click` | any "Reserve" button | custom `CTAClick` | conversion if label set |
| `form_start` | first focus in the form | custom `FormStart` | conversion if label set |
| `form_submit` | valid submit (deposit or waitlist; `method` param) | `Lead` | conversion if label set |
| `deposit_click` | "Pay ₹500" button clicked (even if validation then fails) | `InitiateCheckout` | conversion if label set |
| `fit_pick` | fit card button | custom `FitPick` | event only |
| `deposit_paid` | return from payment (`?paid=1`) | `Purchase` | event only |

In Google Ads, create one conversion action per label. Mark only `form_submit` / `deposit_click` as primary, or you'll optimise for CTA clicks.

## Decisions worth a second look

- **Required fields:** the brief required name, WhatsApp and city. I also required **height, waist and fit**, since sizing and the fit vote are the point of the experiment. To relax, remove the field from `FIELDS` in the script.
- **Legal copy:** privacy/refund pages are drafts. Have someone check them, especially the refund and delay/cancellation terms, before taking money.
- **No cookie banner** is included (not in scope). Consider one if you run ads to a broad audience.
