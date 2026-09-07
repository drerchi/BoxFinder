import * as cheerio from 'npm:cheerio@1.2.0';
import { parseCzPrice } from '../lib/priceUtils.ts';
import { modelKey } from '../lib/modelKey.ts';
import { fetchHtml } from '../lib/httpClient.ts';

const ORIGIN = 'https://www.datart.cz';
const MAX_PAGES = 15;

export interface RawDatartItem {
  site: 'datart';
  id: string;
  name: string;
  condition: string | null;
  url: string;
  currentPrice: number;
  ownOriginalPrice: number | null;
  modelKey: string | null;
}

function absoluteUrl(href: string | undefined | null): string | null {
  if (!href) return null;
  return href.startsWith('http') ? href : `${ORIGIN}${href}`;
}

function parsePage(html: string) {
  const $ = cheerio.load(html);
  const items: RawDatartItem[] = [];

  $('.product-box.product-box-sale').each((_: number, el: any) => {
    const box = $(el);

    const link = box.find('.product-box-link-box').first();
    const href = link.attr('href');
    if (!href) return;

    let name: string | undefined = box.find('.product-box-link-box img').first().attr('alt')?.trim();
    let condition: string | null = null;
    const gtmRaw = box.attr('data-gtm-data-product');
    if (gtmRaw) {
      try {
        const gtm = JSON.parse(gtmRaw);
        name = gtm.item_name || name;
        condition = gtm.item_labels || null;
      } catch {
        // ignore malformed gtm json, fall back to img alt text
      }
    }
    if (!name) return;

    const currentPrice = parseCzPrice(box.find('.item-price[data-product-price]').first().attr('data-product-price'));
    if (!currentPrice) return;

    // Datart shows a "new" comparison price under one of two classes -
    // `--strike` (visually struck through) or `--lessOrEqual` (current price
    // already at/below the reference, so no strike shown) - both carry the
    // same "Prodejní cena nového produktu" comparison, just styled
    // differently. Only genuinely missing for listings Datart doesn't
    // currently sell new at all; the caller fills that gap from the
    // reference price table when this is null.
    const strikeEl = box.find('.cut-price--strike, .cut-price--lessOrEqual').first().clone();
    strikeEl.find('.sr-only').remove();
    const ownOriginalPrice = parseCzPrice(strikeEl.text());

    items.push({
      site: 'datart',
      id: box.attr('data-product-match') || href,
      name,
      condition,
      url: absoluteUrl(href)!,
      currentPrice,
      ownOriginalPrice,
      modelKey: modelKey(name),
    });
  });

  const nextHref = absoluteUrl($('a.js-pagination-show-next').first().attr('href'));

  return { items, nextHref };
}

export async function fetchDatartListings(startUrl: string): Promise<RawDatartItem[]> {
  let url: string | null = startUrl.split('#')[0];
  const results: RawDatartItem[] = [];
  const seenUrls = new Set<string>();

  for (let page = 0; page < MAX_PAGES && url && !seenUrls.has(url); page++) {
    seenUrls.add(url);
    const html = await fetchHtml(url);
    const { items, nextHref } = parsePage(html);
    results.push(...items);
    url = nextHref;
  }

  return results;
}
