import { fetchAlzaListings } from './scrapers/alza.ts';
import { fetchDatartListings, RawDatartItem } from './scrapers/datart.ts';
import { sendTelegramMessage, formatDealMessage, Deal } from './lib/telegram.ts';
import { createStore } from './lib/store.ts';
import { discountPercent } from './lib/priceUtils.ts';

// Fallback defaults, used only if the `settings` table is empty/unreachable -
// normally these three come from there instead, editable via the control
// panel (docs/index.html) without a redeploy.
const DEFAULT_ALZA_URL = 'https://www.alza.cz/levne-iphone/18851638.htm#f&cst=2,3,1&cud=0&pg=1-2&pn=1&prod=&sc=4750';
const DEFAULT_DATART_URL = 'https://www.datart.cz/iphone.html/filter/o:3/v:-7:4:3:5:6';
const DEFAULT_THRESHOLD = Number(Deno.env.get('DISCOUNT_THRESHOLD_PERCENT') ?? 20);

function resolveDatartItems(datartItems: RawDatartItem[], referenceMap: Map<string, number>): Deal[] {
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
    } as Deal & { priceSource: string };
  });
}

async function runScan() {
  const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
  const SUPABASE_URL = Deno.env.get('SB_URL') ?? Deno.env.get('SUPABASE_URL');
  const SUPABASE_KEY = Deno.env.get('SB_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  const missing = [
    ['TELEGRAM_BOT_TOKEN', BOT_TOKEN],
    ['TELEGRAM_CHAT_ID', CHAT_ID],
    ['SB_URL/SUPABASE_URL', SUPABASE_URL],
    ['SB_SERVICE_ROLE_KEY/SUPABASE_SERVICE_ROLE_KEY', SUPABASE_KEY],
  ].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`Missing required secrets: ${missing.join(', ')}`);

  const store = createStore(SUPABASE_URL!, SUPABASE_KEY!);

  const settings = await store.getSettings();
  const ALZA_URL = settings.alza_url || DEFAULT_ALZA_URL;
  const DATART_URL = settings.datart_url || DEFAULT_DATART_URL;
  const THRESHOLD = Number(settings.discount_threshold_percent) || DEFAULT_THRESHOLD;

  console.log(`[${new Date().toISOString()}] Scanning Alza and Datart for openbox deals...`);

  const debugErrors: Record<string, string> = {};
  const [alzaResult, datartRaw] = await Promise.all([
    fetchAlzaListings(ALZA_URL).catch((err) => {
      console.error('Alza scrape failed:', err.message);
      debugErrors.alza = `${err.message}\n${err.stack ?? ''}`;
      return { items: [] as Deal[], newPriceReferences: [] as { key: string; price: number }[] };
    }),
    fetchDatartListings(DATART_URL).catch((err) => {
      console.error('Datart scrape failed:', err.message);
      debugErrors.datart = `${err.message}\n${err.stack ?? ''}`;
      return [] as RawDatartItem[];
    }),
  ]);

  const referenceMap = await store.getReferencePrices();
  for (const { key, price } of alzaResult.newPriceReferences) referenceMap.set(key, price);
  await store.upsertReferencePrices(alzaResult.newPriceReferences);

  const datartItems = resolveDatartItems(datartRaw, referenceMap);
  const resolvedCount = datartItems.filter((i: any) => i.priceSource !== 'none').length;
  const referenceOnlyCount = datartItems.filter((i: any) => i.priceSource === 'reference').length;

  const all: Deal[] = [...alzaResult.items, ...datartItems];
  const summaryLine =
    `Found ${all.length} openbox listings (Alza: ${alzaResult.items.length}, Datart: ${datartItems.length}, ` +
    `${resolvedCount}/${datartItems.length} Datart listings have a comparable price, ${referenceOnlyCount} via the reference table).`;
  console.log(summaryLine);

  // On the very first run the tracking table is empty, so every item would
  // otherwise look "new" - seed the table quietly instead of flooding the chat.
  const isBootstrap = await store.isEmpty();

  let notifiedCount = 0;
  const notified: string[] = [];
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

    const tags: string[] = [];
    if (isNewForRecordKeeping) tags.push('new');
    if (shouldNotifyDiscount) tags.push('discount');

    let didNotify = false;
    if (shouldNotifyDiscount) {
      try {
        await sendTelegramMessage(BOT_TOKEN!, CHAT_ID!, formatDealMessage(item, tags));
        didNotify = true;
        notifiedCount++;
        const line = `Notified [${tags.join('+')}]: [${item.site}] ${item.name} - ${item.discountPercent.toFixed(1)}% (${item.currentPrice} Kč)`;
        console.log(line);
        notified.push(line);
        // Stay under Telegram's per-chat flood limit (~1 msg/sec) when several
        // deals fire in the same run.
        await new Promise((r) => setTimeout(r, 1200));
      } catch (err: any) {
        // Leave didNotify false so this item isn't marked as notified - it'll
        // be retried on the next scan instead of silently dropped.
        console.error(`Telegram send failed for ${item.name}:`, err.message);
        debugErrors[`telegram:${dealId}`] = err.message;
      }
    }

    await store.upsertScan(dealId, item, existing, isNewForRecordKeeping, didNotify);
  }

  console.log(`Done. Sent ${notifiedCount} Telegram notification(s).`);

  return { summary: summaryLine, notifiedCount, notified, isBootstrap, debugErrors, settings: { ALZA_URL, DATART_URL, THRESHOLD } };
}

Deno.serve(async (req) => {
  try {
    const result = await runScan();
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Fatal error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
