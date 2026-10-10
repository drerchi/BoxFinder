import * as cheerio from 'npm:cheerio@1.2.0';
import { parseCzPrice } from '../lib/priceUtils.ts';
import { modelKey } from '../lib/modelKey.ts';
import { fetchHtml } from '../lib/httpClient.ts';

const ORIGIN = 'https://www.alza.cz';
const MAX_PAGES = 15;

export interface RawAlzaItem {
  site: 'alza';
  id: string;
  name: string;
  condition: null;
  url: string;
  currentPrice: number;
  ownOriginalPrice: number | null;
  modelKey: string | null;
}

// Alza's condition filter (openbox/bazaar/refurb) is applied client-side via a
// URL hash, which a plain fetch can't see - so this walks the whole category
// and picks the openbox listings out by static signals instead:
// - their product URL is a "-bazar-d123.htm" / "-levne-d123.htm" /
//   "-sleva-d123.htm" variant (brand-new listings are plain "-d123.htm") -
//   confirmed against Alza's own condition filter, covers every openbox item;
// - most (not all) also state the new equivalent's price as "Nový X Kč".
// The ones without "Nový" get their comparison price from the reference
// table in index.ts, same as Datart.
const OPENBOX_URL_PATTERN = /-(bazar|levne|sleva)-d\d+\.htm/i;

function isNovyComparison(originalPriceText: string | undefined): boolean {
  return /^\s*nov[ýy]/i.test(originalPriceText ?? '');
}

function parsePage(html: string) {
  const $ = cheerio.load(html);
  const items: RawAlzaItem[] = [];
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
    if (!currentPrice) return;

    const ownOriginalPrice = isNovyComparison(originalText) ? parseCzPrice(originalText) : null;
    const key = modelKey(name);

    if (ownOriginalPrice || OPENBOX_URL_PATTERN.test(href)) {
      items.push({
        site: 'alza',
        id: box.attr('data-id') || href,
        name,
        condition: null,
        url: href.startsWith('http') ? href : `${ORIGIN}${href}`,
        currentPrice,
        ownOriginalPrice,
        modelKey: key,
      });

      // The "Nový X Kč" comparison Alza states on its own openbox listing is
      // itself a legitimate new-price data point for this model+storage - not
      // just a reference for computing *this* item's own discount. Harvest it
      // too, so models that only ever appear as openbox here (never as a
      // plain new listing) still get a usable reference price.
      if (key && ownOriginalPrice) newPriceReferences.push({ key, price: ownOriginalPrice });
    } else if (key) {
      // A brand-new listing - its current price doubles as a reference "new"
      // price for this model+storage.
      newPriceReferences.push({ key, price: currentPrice });
    }
  });

  const nextHref = $('link[rel="next"]').attr('href') || null;

  return { items, newPriceReferences, nextHref };
}

export async function fetchAlzaListings(startUrl: string) {
  let url: string | null = startUrl.split('#')[0];
  const items: RawAlzaItem[] = [];
  const newPriceReferences: { key: string; price: number }[] = [];
  const seenUrls = new Set<string>();

  for (let page = 0; page < MAX_PAGES && url && !seenUrls.has(url); page++) {
    seenUrls.add(url);
    let html: string;
    try {
      html = await fetchHtml(url);
    } catch (err: any) {
      // Alza's own rel=next chain occasionally points at a malformed URL a
      // few pages deep - stop paginating rather than losing everything
      // already collected from earlier pages.
      console.error(`Alza pagination stopped at ${url}: ${err.message}`);
      break;
    }
    const parsed = parsePage(html);
    items.push(...parsed.items);
    newPriceReferences.push(...parsed.newPriceReferences);
    url = parsed.nextHref;
  }

  return { items, newPriceReferences };
}
