import 'dotenv/config';
import { fetchAlzaListings } from './scrapers/alza.js';
import { fetchDatartListings } from './scrapers/datart.js';
import { sendTelegramMessage, formatDealMessage } from './lib/telegram.js';
import { createStore } from './lib/store.js';
import { discountPercent } from './lib/priceUtils.js';

// Fallback defaults, used only if the `settings` table is empty/unreachable -
// normally these three come from there instead, editable via the control
// panel (docs/index.html) without touching code.
const DEFAULT_ALZA_URL = 'https://www.alza.cz/levne-iphone/18851638.htm#f&cst=2,3,1&cud=0&pg=1-2&pn=1&prod=&sc=4750';
const DEFAULT_DATART_URL = 'https://www.datart.cz/iphone.html/filter/o:3/v:-7:4:3:5:6';
const DEFAULT_THRESHOLD = Number(process.env.DISCOUNT_THRESHOLD_PERCENT ?? 20);
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

// Datart doesn't always state its own "new" comparison price for an openbox
// listing (different color/storage not currently sold new, out of stock,
// etc). Fill the gap from the reference price table harvested from Alza's
// brand-new listings, matched by normalized model+storage key.
function resolveDatartItems(datartItems, referenceMap) {
  return datartItems.map((item) => {
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
  requireEnv();
  const store = createStore(SUPABASE_URL, SUPABASE_KEY);

  const settings = await store.getSettings();
  const ALZA_URL = settings.alza_url || DEFAULT_ALZA_URL;
  const DATART_URL = settings.datart_url || DEFAULT_DATART_URL;
  const THRESHOLD = Number(settings.discount_threshold_percent) || DEFAULT_THRESHOLD;

  console.log(`[${new Date().toISOString()}] Scanning Alza and Datart for openbox deals...`);

  const [alzaResult, datartRaw] = await Promise.all([
    fetchAlzaListings(ALZA_URL).catch((err) => {
      console.error('Alza scrape failed:', err.message);
      return { items: [], newPriceReferences: [] };
    }),
    fetchDatartListings(DATART_URL).catch((err) => {
      console.error('Datart scrape failed:', err.message);
      return [];
    }),
  ]);

  const referenceMap = await store.getReferencePrices();
  for (const { key, price } of alzaResult.newPriceReferences) referenceMap.set(key, price);
  await store.upsertReferencePrices(alzaResult.newPriceReferences);

  const datartItems = resolveDatartItems(datartRaw, referenceMap);
  const resolvedCount = datartItems.filter((i) => i.priceSource !== 'none').length;
  const referenceOnlyCount = datartItems.filter((i) => i.priceSource === 'reference').length;

  const all = [...alzaResult.items, ...datartItems];
  console.log(
    `Found ${all.length} openbox listings (Alza: ${alzaResult.items.length}, Datart: ${datartItems.length}, ` +
      `${resolvedCount}/${datartItems.length} Datart listings have a comparable price, ${referenceOnlyCount} via the reference table).`
  );

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
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exitCode = 1;
});
