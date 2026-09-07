import * as cheerio from 'npm:cheerio@1.2.0';
import { parseCzPrice, discountPercent } from '../lib/priceUtils.ts';
import { modelKey } from '../lib/modelKey.ts';
import { fetchHtml } from '../lib/httpClient.ts';
import type { Deal } from '../lib/telegram.ts';

const ORIGIN = 'https://www.alza.cz';
const MAX_PAGES = 15;

// Alza's condition filter (openbox/bazaar/refurb) is applied client-side via a
// URL hash, which a plain fetch can't see. Instead we detect openbox-condition
// listings by a static signal: their "original price" comparison is prefixed
// "Nový" (= price of the brand-new equivalent), which only appears on
// openbox/bazaar/refurb items.
function isOpenboxComparison(originalPriceText: string | undefined): boolean {
  return /^\s*nov[ýy]/i.test(originalPriceText ?? '');
}

function parsePage(html: string) {
  const $ = cheerio.load(html);
  const items: Deal[] = [];
  const newPriceReferences: { key: string; price: number }[] = [];

  $('.box.browsingitem').each((_: number, el: any) => {
    const box = $(el);
    const link = box.find('a.name.browsinglink.js-box-link').first();
    const name = link.text().trim();
    const href = link.attr('href');
    if (!name || !href) return;

    const currentText = box.find('.js-price-box__primary-price__value').first().text();
    const originalText = box.find('.ads-pb__original-price').first().text();
    const currentPrice = parseCzPrice(currentText);

    if (isOpenboxComparison(originalText)) {
      const originalPrice = parseCzPrice(originalText);
      if (!currentPrice || !originalPrice) return;

      items.push({
        site: 'alza',
        id: box.attr('data-id') || href,
        name,
        url: href.startsWith('http') ? href : `${ORIGIN}${href}`,
        currentPrice,
        originalPrice,
        discountPercent: discountPercent(originalPrice, currentPrice),
      });
    } else if (currentPrice) {
      const key = modelKey(name);
      if (key) newPriceReferences.push({ key, price: currentPrice });
    }
  });

  const nextHref = $('link[rel="next"]').attr('href') || null;

  return { items, newPriceReferences, nextHref };
}

export async function fetchAlzaListings(startUrl: string) {
  let url: string | null = startUrl.split('#')[0];
  const items: Deal[] = [];
  const newPriceReferences: { key: string; price: number }[] = [];
  const seenUrls = new Set<string>();

  for (let page = 0; page < MAX_PAGES && url && !seenUrls.has(url); page++) {
    seenUrls.add(url);
    const html = await fetchHtml(url);
    const parsed = parsePage(html);
    items.push(...parsed.items);
    newPriceReferences.push(...parsed.newPriceReferences);
    url = parsed.nextHref;
  }

  return { items, newPriceReferences };
}
