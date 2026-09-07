# BoxFinder

Scans the Alza and Datart openbox/bazaar iPhone listings, computes each item's
discount vs. the price of a brand-new equivalent, and sends a Telegram message
when a listing is either brand new to the catalog or discounted at/above a
configurable threshold (default 20%). Pure HTML scraping + arithmetic - no
AI/LLM calls involved.

**Live deployment:** runs as a Supabase Edge Function (`supabase/functions/scan-deals`)
on a cron schedule, once daily at 9:00 Europe/Prague. `src/` is the original
Node CLI version, kept around for local testing/debugging - both share the
same Supabase tables, so running either one is safe and they stay in sync.

**Control panel:** https://drerchi.github.io/BoxFinder/ - a static page
(`docs/index.html`, deployed via GitHub Pages) to edit the Alza/Datart URLs and
discount threshold, trigger a scan on demand, and see recently tracked items.
It talks directly to Supabase from your browser using your service_role key,
entered once and kept only in that browser's `localStorage` - never in the
page's source or the repo.

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
- `lib/store` keeps one row per product in `openbox_products`. Two kinds of
  alert exist - "new listing" and "big discount" - each firing **at most once
  ever** per item (`notified_new_at` / `notified_discount_at`), independently
  of each other, regardless of later price changes.
- Every alert always shows current price, original price, and discount % when
  a comparable original price is known (own or from the reference table);
  falls back to price-only for the rare item with no comparable price anywhere.
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

**Cost note:** ScraperAPI's free tier is a one-time 5,000-credit signup bonus,
not a recurring monthly allowance. Measured directly (not estimated): one full
scan of both sites costs ~51 credits, likely because ScraperAPI auto-upgrades
to its premium/residential proxy tier for these specific protected sites (a
bare-tier proxy is exactly what gets blocked in the first place). At 1
run/day that's ~51 credits/day - the free balance lasts roughly 3 months from
when it was first used, after which the Hobby plan ($49/mo) is needed to keep
the cloud version running. The local `src/` version has no such cost since
it isn't blocked by IP in the first place.

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
once daily (`0 7 * * *` UTC = 9:00 Europe/Prague during CEST/summer - bump to
hour 8 once clocks fall back to CET/winter in late October). Check on it from
the SQL editor:

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

### Local Node version (optional, for testing)

1. `npm install`
2. Copy `.env.example` to `.env` and fill in `TELEGRAM_BOT_TOKEN`,
   `TELEGRAM_CHAT_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
3. `npm run scan`
