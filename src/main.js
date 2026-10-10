import 'dotenv/config';
import { fetchAlzaListings } from './scrapers/alza.js';
import { fetchDatartListings } from './scrapers/datart.js';
import { sendTelegramMessage, formatDealMessage } from './lib/telegram.js';
import { createStore } from './lib/store.js';
import { discountPercent } from './lib/priceUtils.js';
import { isWantedGeneration } from './lib/modelKey.js';

// Fallback defaults, used only if the `settings` table is empty/unreachable -
// normally these three come from there instead, editable via the control
// panel (docs/index.html) without touching code.
const DEFAULT_ALZA_URL = 'https://www.alza.cz/levne-iphone/18851638.htm#f&cst=2,3,1&cud=0&pg=1-2&pn=1&prod=&sc=4750';
const DEFAULT_DATART_URL = 'https://www.datart.cz/iphone.html/filter/o:3/v:-7:4:3:5:6';
const DEFAULT_THRESHOLD = Number(process.env.DISCOUNT_THRESHOLD_PERCENT ?? 20);
// Alza's own model filter can't be passed through reliably, so the oldest
// wanted iPhone generation is enforced here, for both sites.
const MIN_GENERATION = Number(process.env.MIN_IPHONE_GENERATION ?? 16);
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// --dry-run: scrape and print what was found, without touching Supabase or
// Telegram (reads settings/reference prices if credentials are present).
const DRY_RUN = process.argv.includes('--dry-run');

function requireEnv() {
  const missing = [];
  if (!BOT_TOKEN) missing.push('TELEGRAM_BOT_TOKEN');
  if (!CHAT_ID) missing.push('TELEGRAM_CHAT_ID');
  if (!SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!SUPABASE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}

// Neither site always states its own "new" comparison price for an openbox
// listing (different color/storage not currently sold new, out of stock,
// etc). Fill the gap from the reference price table harvested from Alza's
// "Nový X Kč" comparisons, matched by normalized model+storage key.
function resolveItems(rawItems, referenceMap) {
  return rawItems.map((item) => {
    const referencePrice = item.modelKey ? referenceMap.get(item.modelKey) : undefined;
    const originalPrice = item.ownOriginalPrice ?? referencePrice ?? null;

    return {
      site: item.site,
      id: item.id,
      name: item.name,
      condition: item.condition,
      url: item.url,
      currentPrice: item.currentPrice,
      originalPrice: originalPrice ?? item.currentPrice,
      discountPercent: originalPrice ? discountPercent(originalPrice, item.currentPrice) : 0,
      priceSource: item.ownOriginalPrice ? 'own' : referencePrice ? 'reference' : 'none',
    };
  });
}

async function main() {
  if (!DRY_RUN) requireEnv();
  const store = SUPABASE_URL && SUPABASE_KEY ? createStore(SUPABASE_URL, SUPABASE_KEY) : null;

  const settings = store ? await store.getSettings() : {};
  const ALZA_URL = settings.alza_url || DEFAULT_ALZA_URL;
  const DATART_URL = settings.datart_url || DEFAULT_DATART_URL;
  const THRESHOLD = Number(settings.discount_threshold_percent) || DEFAULT_THRESHOLD;

  console.log(`[${new Date().toISOString()}] Scanning Alza and Datart for openbox deals${DRY_RUN ? ' (dry run)' : ''}...`);

  // Sequential, not parallel: Alza opens a Chrome window, and keeping the
  // Datart fetch out of that window's way makes failures easier to read.
  let alzaFailed = false;
  const alzaResult = await fetchAlzaListings(ALZA_URL).catch((err) => {
    console.error('Alza scrape failed:', err.message);
    alzaFailed = true;
    return { items: [], newPriceReferences: [] };
  });
  let datartFailed = false;
  const datartRaw = await fetchDatartListings(DATART_URL).catch((err) => {
    console.error('Datart scrape failed:', err.message);
    datartFailed = true;
    return [];
  });

  const referenceMap = store ? await store.getReferencePrices() : new Map();
  for (const { key, price } of alzaResult.newPriceReferences) referenceMap.set(key, price);
  if (store && !DRY_RUN) await store.upsertReferencePrices(alzaResult.newPriceReferences);

  const scraped = resolveItems([...alzaResult.items, ...datartRaw], referenceMap);
  const all = scraped.filter((i) => isWantedGeneration(i.name, MIN_GENERATION));
  const count = (site) => all.filter((i) => i.site === site).length;
  const unpriced = all.filter((i) => i.priceSource === 'none').length;
  console.log(
    `Found ${all.length} openbox listings, iPhone ${MIN_GENERATION}+ (Alza: ${count('alza')}, Datart: ${count('datart')}; ` +
      `${scraped.length - all.length} older models skipped; ${unpriced} with no comparable new price).`
  );

  if (DRY_RUN) {
    for (const i of all) {
      const pct = i.priceSource === 'none' ? '   -  ' : `${i.discountPercent.toFixed(1).padStart(5)}%`;
      console.log(`  [${i.site}] ${pct}  ${String(i.currentPrice).padStart(6)} Kč  ${i.name}`);
    }
    return;
  }

  // On the very first run the tracking table is empty, so every item would
  // otherwise look "new" - seed the table quietly instead of flooding the chat.
  const isBootstrap = await store.isEmpty();

  let notifiedCount = 0;
  for (const item of all) {
    const dealId = `${item.site}:${item.id}`;
    const existing = await store.getExisting(dealId);

    const isNewListing = !existing;
    const isDiscount = item.discountPercent >= THRESHOLD;
    // "New listing" is tracked for bookkeeping/the control panel's badge, but
    // no longer sends a Telegram message by itself - only a genuine discount
    // crossing does, and (like before) at most once ever per item.
    const isNewForRecordKeeping = isNewListing && !isBootstrap;
    const shouldNotifyDiscount = isDiscount && !existing?.notified_discount_at;

    const tags = [];
    if (isNewForRecordKeeping) tags.push('new');
    if (shouldNotifyDiscount) tags.push('discount');

    let didNotify = false;
    if (shouldNotifyDiscount) {
      try {
        await sendTelegramMessage(BOT_TOKEN, CHAT_ID, formatDealMessage(item, tags));
        didNotify = true;
        notifiedCount++;
        console.log(`Notified [${tags.join('+')}]: [${item.site}] ${item.name} - ${item.discountPercent.toFixed(1)}% (${item.currentPrice} Kč)`);
        // Stay under Telegram's per-chat flood limit (~1 msg/sec) when several
        // deals fire in the same run.
        await new Promise((r) => setTimeout(r, 1200));
      } catch (err) {
        // Leave didNotify false so this item isn't marked as notified - it'll
        // be retried on the next scan instead of silently dropped.
        console.error(`Telegram send failed for ${item.name}:`, err.message);
      }
    }

    await store.upsertScan(dealId, item, existing, isNewForRecordKeeping, didNotify);
  }

  console.log(`Done. Sent ${notifiedCount} Telegram notification(s).`);
  // Non-zero exit when a site failed, so Task Scheduler's "Last Run Result"
  // shows something went wrong instead of a misleading success.
  if (alzaFailed || datartFailed) {
    process.exitCode = 2;
    return;
  }
  // Heartbeat for the cloud fallback: the Edge Function skips its own
  // (ScraperAPI-paid) scan while this is recent. Only written after both
  // sites scraped fine, so a broken laptop run lets the cloud take over.
  await store.setSetting('last_local_scan_at', new Date().toISOString());
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exitCode = 1;
});
