import * as cheerio from 'cheerio';
import { fetchHtml } from '../lib/fetchHtml.js';
import { parseCzPrice, discountPercent } from '../lib/priceUtils.js';
import { modelKey } from '../lib/modelKey.js';

const ORIGIN = 'https://www.datart.cz';
const MAX_PAGES = 15;

function absoluteUrl(href) {
  if (!href) return null;
  return href.startsWith('http') ? href : `${ORIGIN}${href}`;
}

function parsePage(html) {
  const $ = cheerio.load(html);
  const items = [];

  $('.product-box.product-box-sale').each((_, el) => {
    const box = $(el);

    const link = box.find('.product-box-link-box').first();
    const href = link.attr('href');
    if (!href) return;

    let name = box.find('.product-box-link-box img').first().attr('alt')?.trim();
    let condition = null;
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

    // Datart only shows a struck-through "new" comparison price when it
    // currently sells that exact model/color/storage as new stock itself -
    // for a lot of openbox listings (different color, out of stock, etc.)
    // there simply is none here. main.js fills that gap from the reference
    // price table when ownOriginalPrice is null.
    const strikeEl = box.find('.cut-price--strike').first().clone();
    strikeEl.find('.sr-only').remove();
    const ownOriginalPrice = parseCzPrice(strikeEl.text());

    items.push({
      site: 'datart',
      id: box.attr('data-product-match') || href,
      name,
      condition,
      url: absoluteUrl(href),
      currentPrice,
      ownOriginalPrice,
      modelKey: modelKey(name),
    });
  });

  const nextHref = absoluteUrl($('a.js-pagination-show-next').first().attr('href'));

  return { items, nextHref };
}

export async function fetchDatartListings(startUrl) {
  let url = startUrl.split('#')[0];
  const results = [];
  const seenUrls = new Set();

  for (let page = 0; page < MAX_PAGES && url && !seenUrls.has(url); page++) {
    seenUrls.add(url);
    const html = await fetchHtml(url);
    const { items, nextHref } = parsePage(html);
    results.push(...items);
    url = nextHref;
  }

  return results;
}
