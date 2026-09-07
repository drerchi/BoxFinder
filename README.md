# BoxFinder

Scans the Alza and Datart openbox/bazaar iPhone listings, computes each item's
discount vs. the price of a brand-new equivalent, and sends a Telegram message
when a listing is either brand new to the catalog or discounted at/above a
configurable threshold (default 15%). Pure HTML scraping + arithmetic - no
AI/LLM calls involved.

**Live deployment:** runs as a Supabase Edge Function (`supabase/functions/scan-deals`)
on a cron schedule, 10x/day. `src/` is the original Node CLI version, kept
around for local testing/debugging - both share the same Supabase tables, so
running either one is safe and they stay in sync.

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
- `lib/store` keeps one row per product in `openbox_products`, so you're
  notified when a listing is either new to the catalog or newly discounted -
  not re-pinged every run for something already flagged.
- `lib/telegram` sends the alert via your bot's `sendMessage` API, paced to
  stay under Telegram's per-chat flood limit.

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
not a recurring monthly allowance - at ~1,200 requests/month (10 runs/day x 2
sites x a few pages each) that lasts roughly 4 months, after which the Hobby
plan ($49/mo) is needed to keep the cloud version running. The local `src/`
version has no such cost since it isn't blocked by IP in the first place.

## Setup

### Database (one-time)

Run `supabase/schema.sql` in the Supabase SQL editor (or via `psql`/CLI) to
create `openbox_products` and `new_iphone_prices`.

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
10x/day (`0 4,6,8,10,12,14,16,18,20,22 * * *`, UTC - roughly 6:00-24:00
Europe/Prague). Check on it from the SQL editor:

```sql
select * from cron.job;
select * from cron.job_run_details order by start_time desc limit 20;
```

To change the schedule, edit the cron expression in `supabase/cron.sql` and
re-run it (it uses `cron.schedule` with the same job name, which replaces the
existing schedule).

### Local Node version (optional, for testing)

1. `npm install`
2. Copy `.env.example` to `.env` and fill in `TELEGRAM_BOT_TOKEN`,
   `TELEGRAM_CHAT_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
3. `npm run scan`
