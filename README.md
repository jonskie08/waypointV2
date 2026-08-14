# Waypoint V2 — Personal Finance (mobile PWA)

A private, single-user personal finance app for your own phone. No account,
no server, no data leaves the device. Static site, no build step.

## What's new in V2
- Full visual redesign: floating glass nav bar (mobile), sidebar nav
  (tablet/desktop), dark mode, refined navy/gold identity, SVG icon set
- Home dashboard: Safe to Spend, "Your money today," restyled hero balance
- Tuition is now a proper debt tracker: multiple charges over time, full
  payment history, remaining balance always derived (never stored/cached)
- Savings Accounts (balance + optional interest, daily-balance estimate,
  accrued vs. posted interest) separate from Savings Goals (progress toward
  a target, optionally linked to an account)
- Monthly Plan (planned vs. actual by category/account)
- Cash-Flow Forecast (7/30/90-day timeline from known bills + payday)
- Insights (rule-based observations + category breakdown)
- Responsive: single column on phones, two-column/sidebar on tablet and
  desktop

## Your data
On first load, V2 automatically migrates your existing data:
- Your old tuition due/paid becomes a tuition charge + your existing
  tuition payments (nothing is deleted)
- Your old savings buckets become Savings Accounts (interest off by
  default), and any bucket with a target becomes a linked Savings Goal
- Everything else (transactions, bills, settings) carries over as-is

Migration is non-destructive — it only adds new data, never deletes the
old stores. It runs once, tracked via a `schemaVersion` flag in settings.

## What's inside
- `index.html`, `style.css`, `app.js`, `db.js`, `calc.js`, `icons.js`
- `manifest.json`, `service-worker.js` — installable, works offline
- `icons/` — home screen icons

Data is stored in **IndexedDB** in your phone's browser storage for this
site. Closing the app, restarting your phone, etc. will not lose data —
only clearing site data/browser storage will.

## Hosting (same as before)
Needs to be served over `https://` (or `localhost`) for the service worker
and "Add to Home Screen" to work properly.

**Fastest — no account needed:**
1. Go to https://app.netlify.com/drop
2. Drag this whole folder onto the page
3. Open the resulting `https://…netlify.app` URL on your phone

**Also easy — GitHub Pages:**
1. Create a repo, upload these files, enable Pages from the `main` branch

**Locally, for testing:**
```
cd waypoint-app
python3 -m http.server 8080
```

## Installing to your home screen
- **iPhone (Safari):** Share icon → "Add to Home Screen"
- **Android (Chrome):** ⋮ menu → "Add to Home screen" / "Install app"

## Backups
More → Settings → Export Backup downloads a `.json` file of everything.
Import Backup on the same screen restores from that file (it warns before
replacing your current data).

## Notes on the model
- **Available balance** is a running total: starting balance + every
  income/interest transaction, minus every expense, savings contribution,
  and tuition payment. Savings withdrawals add back to available balance.
- **Tuition remaining** = sum of tuition charges − sum of tuition
  payments, computed live — never stored, so it can't drift out of sync.
- **Savings account balance** is stored (needed for interest calc) and
  kept in sync by every contribution/withdrawal/interest posting.
- **Interest** is estimated using each day's actual closing balance, not
  the current balance applied to the whole month. It's clearly labelled
  as an estimate — your bank's real calculation may differ.
- **Safe to Spend** and the **Cash-Flow Forecast** are estimates based on
  known bills and your regular payday — not guaranteed financial advice.
