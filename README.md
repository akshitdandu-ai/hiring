# Pre-Flight

A conversational shipment-booking assistant and "pre-flight" error checker for **UK → Germany / France / Netherlands** shipments.
Describe a shipment in plain English, or upload a Bookings + Items workbook. Pre-Flight finds what is wrong, how serious it is and how to fix it, recommends a carrier for the seller's priority, and writes a confirmation in plain language.

* **No login, no sign-up, no paywall, no database.** Everything runs in the browser.
* **All rule checks and carrier choices are deterministic code.** An LLM is optional, off by default, and never writes replies or decides anything.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest: rules, boundaries, parser, chat flows, ingest
npm run build      # type-check + production build into dist/
```

The team name in the header comes from `VITE_TEAM_NAME` (build-time). See `.env.example`.

## Deploy (public link)

Import the repo into Vercel (framework: Vite, defaults are fine; `vercel.json` is included). **Project → Settings → Deployment Protection must be OFF** (Vercel Authentication disabled) or the link will ask visitors to log in. Set `VITE_TEAM_NAME` in the project's environment variables. Check it in an incognito window.

## Layout

```
src/
  config/      fixed data: allowed values + aliases, carrier rate card (Sheet 3), rulebook (Sheet 4), dangerous-goods keywords
  model/       Booking, Item, Finding, CarrierOption, BookingResult
  engine/      pure functions shared by chat and file upload
    rules/R01..R10, dataChecks, sanityChecks, carrierEngine, deriveTotals, evaluateBooking, confirmation
  ingest/      workbook/CSV reader (sheets found by headers), tolerant header + value coercion, assembler, sample data
  chat/        extractor (rule-based + optional LLM), slotTracker, questionPlanner, changeDetector, conversationState, UI
  ui/          app shell, batch table, checks panel, carrier card + comparison, confirmation card
api/extract.ts optional LLM extraction function (Vercel)
tests/         Vitest suites + fixtures
```

## How decisions are made

* **Status:** any Red or DATA finding → *Blocked*; only Amber → *Needs attention*; otherwise *Ready*.
* **Rules R-01 … R-10** are in `src/engine/rules`, one file each, each returning findings with rule id, plain-English problem, the numbers (evidence) and a concrete fix. A rule that cannot run because of bad data reports "Could not check: <reason>" rather than passing. Passed rules are listed too.
* **Data problems that are not rule breaks** (bad date, pallets = 0, unsupported city, city/country mismatch, non-GBP currency, orphan items, duplicate IDs…) are `DATA` findings and also block the booking.
* **Carrier:** filter by route, price = price/pallet × pallets, eligible if weight per pallet ≤ carrier max, rank eligible options by priority (Cheapest / Fastest / Most reliable with the specified tie-breaks; Balanced = min-max normalised average of cost, transit and unreliability, with the score breakdown shown). R-05 is checked against the recommended carrier; if no carrier can take the load, the minimum pallets needed and the new cost are suggested.
* **Chat:** every field is extracted from every message; only missing fields are asked, at most 3 per turn, grouped route → goods → packing → value & weight → date & appointment → priority. Items' cartons / booking cartons / declared value can be offered as calculated values for confirmation (marked *calculated-confirmed*). HS codes are never invented: only a hint ("often under heading 6912") is given. Edits ("add a pallet", "change it to Lyon", "drop the mugs", "undo", "start over") show a diff line and re-run everything.
* **Optional LLM** (`VITE_ENABLE_LLM=true` + `ANTHROPIC_API_KEY` on the server): `POST /api/extract` returns JSON field updates (temperature 0), validated with zod; on error, timeout (> 6 s) or missing key the rule-based parser is used. Replies always come from templates.

## Interpretations worth knowing

* Dates are always **day-first**. With no year, the next future occurrence is used. "Friday" = the coming Friday; "next Friday" = the Friday of next week. The assistant states the date it understood.
* A date in the past is accepted in chat with a warning (R-10 then flags it).
* ETA = ready date (or today, if the date is missing/past) + transit days, labelled *estimated, calendar days*.
* The destination **city** decides the route country when it disagrees with the stated country (the mismatch is reported as a DATA finding).
* A blank appointment cell is treated as "No" and reported; a blank priority defaults to Balanced and is reported.
