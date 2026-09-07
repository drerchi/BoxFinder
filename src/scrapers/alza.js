import * as cheerio from 'cheerio';
import { fetchHtmlViaCurl } from '../lib/fetchHtml.js';
import { parseCzPrice, discountPercent } from '../lib/priceUtils.js';
import { modelKey } from '../lib/modelKey.js';

const ORIGIN = 'https://www.alza.cz';
const MAX_PAGES = 15;

// Alza's condition filter (openbox/bazaar/refurb) is applied client-side via a
// URL hash, which a plain HTTP fetch can't see, and Alza's Cloudflare blocks
// headless browsers. Instead we detect openbox-condition listings by a static
// signal: their "original price" comparison is prefixed "Nový" (= price of the
// brand-new equivalent), which only appears on openbox/bazaar/refurb items.
function isOpenboxComparison(originalPriceText) {
  return /^\s*nov[ýy]/i.test(originalPriceText ?? '');
}

function parsePage(html) {
  const $ = cheerio.load(html);
  const items = [];
  const newPriceReferences = [];

  $('.box.browsingitem').each((_, el) => {
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
      // A brand-new-condition listing (no openbox comparison) - its current
      // price doubles as a reference "new" price for this model+storage,
      // used as a fallback for openbox listings elsewhere that don't state one.
      const key = modelKey(name);
      if (key) newPriceReferences.push({ key, price: currentPrice });
    }
  });

  const nextHref = $('link[rel="next"]').attr('href') || null;

  return { items, newPriceReferences, nextHref };
}

export async function fetchAlzaListings(startUrl) {
  let url = startUrl.split('#')[0];
  const items = [];
  const newPriceReferences = [];
  const seenUrls = new Set();

  for (let page = 0; page < MAX_PAGES && url && !seenUrls.has(url); page++) {
    seenUrls.add(url);
    const html = await fetchHtmlViaCurl(url);
    const parsed = parsePage(html);
    items.push(...parsed.items);
    newPriceReferences.push(...parsed.newPriceReferences);
    url = parsed.nextHref;
  }

  return { items, newPriceReferences };
}
