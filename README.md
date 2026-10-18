# BoxFinder

Scans the Alza and Datart openbox/bazaar iPhone listings, computes each item's
discount vs. the price of a brand-new equivalent, and sends a Telegram message
when a listing is discounted at/above a configurable threshold. Pure HTML
scraping + arithmetic - no AI/LLM calls involved.

**Live deployment:** hybrid. The laptop (`src/`, Windows scheduled task) is the
main scanner - it's free and runs hourly. The Supabase Edge Function
(`supabase/functions/scan-deals`) is a once-a-day away-from-home catch-up: a
single cron check at 13:05 Europe/Prague asks "did the laptop scan since
~8:00?" - if yes, it's a no-op; if not, it scans once (spending ScraperAPI
credits) as that day's only cloud run. Both write to the same Supabase tables,
so switching between them (or running neither for a day) never causes
duplicate alerts.

**Control panel:** https://drerchi.github.io/BoxFinder/ - a static page
(`docs/index.html`, deployed via GitHub Pages) to edit the Alza/Datart URLs and
discount threshold, trigger a scan on demand, and see recently tracked items.
Public page, no login - talks to Supabase with a hardcoded anon key scoped by
RLS policies (read settings/tracked items, write only settings - see
`supabase/schema.sql`).

## How it works

- The Alza and Datart scrapers fetch the listing pages (following pagination
  automatically) and parse out `{ name, url, currentPrice, originalPrice,
  discountPercent }` for every openbox item.
  - Alza: an item counts as openbox when its comparison price is prefixed "Nový"
    (price of the new equivalent) - this is how Alza itself marks bazaar/refurb/outlet
    listings in the page HTML, and it doesn't depend on replicating the site's
    hash-based UI filter (which only applies client-side anyway).
  - Datart: items under `/bazar/`. Datart only shows its own "new" comparison
    price for about a quarter of these listings - for the rest, the price is
    filled in from a reference table (`new_iphone_prices`) harvested from
    Alza's own brand-new (non-bazar) listings each scan, matched by a
    normalized model+storage key (see `lib/modelKey`).
- `lib/store` keeps one row per product in `openbox_products`. Only a discount
  at/above the threshold sends a Telegram message, and only **once ever** per
  item (`notified_discount_at`), regardless of later price changes - a genuine
  new listing alone no longer pings by itself (it used to; too noisy in
  practice since most new listings aren't actually discounted). "New" is still
  tracked (`notified_new_at`) for the control panel's badge, and still shows
  as a bonus badge alongside a real discount alert when both are true.
- Every alert shows current price, original price, and discount % when a
  comparable original price is known (own or from the reference table); falls
  back to price-only for the rare item with no comparable price anywhere
  (shown as "-" in the control panel, not a misleading "0%").
- `lib/telegram` sends the alert via your bot's `sendMessage` API, paced to
  stay under Telegram's per-chat flood limit.
- `alza_url`, `datart_url`, and `discount_threshold_percent` are read from the
  `settings` table at the start of every scan (editable via the control panel
  above, no redeploy needed) - the values in the scraper files are only a
  fallback if that table is ever empty/unreachable.

## Why the Edge Function routes through ScraperAPI

Both Alza (Cloudflare) and Datart (F5/Shape) block requests from Supabase's
datacenter IP range outright - confirmed via live testing: Alza returns a
plain 403, Datart returns a 200 with a JS bot-challenge page instead of real
content. Neither blocks a normal home/residential IP. `lib/httpClient.ts`
routes every request through ScraperAPI (residential/rotating IPs) when
`SCRAPERAPI_KEY` is set, which is how the deployed function gets through; the
local Node version doesn't need this since it runs from a normal home IP
(Alza still specifically blocks Node's own `fetch` client there regardless of
IP, which is why `src/lib/fetchHtml.js` shells out to `curl` for Alza only -
unrelated issue, different cause, only relevant to the local version).

**Cost note:** ScraperAPI's plan is 1,000 credits/month, and one full scan of
both sites costs ~51 credits (likely ScraperAPI auto-upgrading to its
premium/residential proxy tier for these specific protected sites - a
bare-tier proxy is exactly what gets blocked in the first place). The cloud
function only runs when the laptop missed its 8:00-13:00 window, so cost
scales with how many days you're away from home, not with time - every day
the laptop checks in, the cloud spends nothing. The local `src/` version has
no such cost since it isn't blocked by IP in the first place.

## Setup

### Database (one-time)

Run `supabase/schema.sql` in the Supabase SQL editor (or via `psql`/CLI) to
create `openbox_products`, `new_iphone_prices`, and `settings`.

### Edge Function (already deployed)

Secrets are set via `supabase secrets set`: `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_CHAT_ID`, `DISCOUNT_THRESHOLD_PERCENT`, `SCRAPERAPI_KEY`.
`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` don't need setting - Supabase
injects those automatically for every Edge Function.

To redeploy after a code change:

```
supabase functions deploy scan-deals
```

### Cron schedule (already active)

`supabase/cron.sql` schedules `scan-openbox-deals` via `pg_cron` + `pg_net`,
once daily at `5 11 * * *` UTC = 13:05 Europe/Prague during CEST/summer - bump
to `5 12 * * *` once clocks fall back to CET/winter in late October. The
function itself decides whether to actually scan (see `skipReason()` and
`LOCAL_CHECK_HOURS`, default 5) based on `last_local_scan_at` - the cron
firing doesn't mean a scan happened. Check on it from the SQL editor:

```sql
select * from cron.job;
select * from cron.job_run_details order by start_time desc limit 20;
```

To change the schedule, edit the cron expression in `supabase/cron.sql` and
re-run it (it uses `cron.schedule` with the same job name, which replaces the
existing schedule).

### Control panel (already deployed)

`docs/index.html`, published via GitHub Pages from this repo (`master` branch,
`/docs` folder) at https://drerchi.github.io/BoxFinder/. To update it, edit
the file and push to `master` - Pages rebuilds automatically.

### Local version on the laptop (main scanner, no ScraperAPI credits)

A full cloud scan costs ~51 credits against a 1,000/month budget, so it's used
sparingly (see above) - the local version in `src/` is the one that actually
runs regularly, on the laptop, for free:

- **Alza:** opens the category in a real Chrome (off-screen window - headless
  Chrome gets a Cloudflare 403) and calls Alza's own
  `/Services/EShopService.svc/Filter` endpoint from inside the page with the
  condition filter (`cst=...`) from the configured `alza_url`. Returns only
  openbox listings, ~24 per call, usually 1-2 calls. Openbox items without a
  "Nový" price get one from the reference table, same as Datart.
- **Datart:** plain HTTP fetch of `datart_url` (its filter is in the path, so
  it's applied server-side).
- Models older than `MIN_IPHONE_GENERATION` (default 16) are skipped on both
  sites.

Setup:

1. `npm install`
2. Copy `.env.example` to `.env` and fill in `TELEGRAM_BOT_TOKEN`,
   `TELEGRAM_CHAT_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
3. `npm run scan -- --dry-run` to see what it finds without writing anything,
   `npm run scan` for a real run.
4. `powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1` registers
   the "BoxFinder scan" scheduled task (default every hour, `00:00`-`23:00`;
   pass e.g. `-Times '09:00','21:00'` to change). It runs while signed in,
   including with the screen locked, wakes the laptop when it can, and catches
   up on runs missed while the laptop was off. Output goes to `logs/scan.log`.
   Each successful run writes `last_local_scan_at` to the `settings` table -
   that's what the cloud function's once-a-day check reads.

No need to unschedule the cloud cron - it's already a no-op whenever the
laptop has checked in recently (see "Live deployment" above), so leaving both
active is the normal, intended state. The control panel's "Run scan now"
button always forces a real cloud scan regardless (costs ~51 credits/click),
for on-demand testing.
