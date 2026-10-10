import * as cheerio from 'cheerio';
import { launchBrowser } from '../lib/browser.js';
import { parseCzPrice } from '../lib/priceUtils.js';
import { modelKey } from '../lib/modelKey.js';

const ORIGIN = 'https://www.alza.cz';
const MAX_PAGES = 15;
const FILTER_ENDPOINT = '/Services/EShopService.svc/Filter';

// Alza's filters (condition = openbox/bazaar, sort, page range) live in the
// URL hash and are applied by the page's own JS calling FILTER_ENDPOINT - a
// plain HTTP fetch only ever gets the unfiltered category (~6 pages, mostly
// brand-new phones). So we open the category in a real Chrome (which also gets
// past Cloudflare), let the page fire one Filter call of its own to capture the
// exact request shape it expects, then call the same endpoint from inside the
// page with the condition filter from the configured URL. Result: only the
// openbox listings, ~24 per page, usually 1-2 calls total.
function parseFilterFromUrl(url) {
  const [base, hash = ''] = url.split('#');
  const params = Object.fromEntries(
    hash.split('&').filter((p) => p.includes('=')).map((p) => p.split('='))
  );
  const categoryId = Number(base.match(/(\d+)(?:-p\d+)?\.htm/)?.[1]);
  if (!categoryId) throw new Error(`Can't find an Alza category id in ${url}`);

  return {
    base,
    categoryId,
    commodityWears: (params.cst || '2,3,1').split(',').filter(Boolean),
    upperDescriptionStatus: Number(params.cud || 0),
    producers: params.prod || '',
  };
}

function parseBoxes(boxesHtml) {
  const $ = cheerio.load(boxesHtml);
  const items = [];

  $('.box.browsingitem').each((_, el) => {
    const box = $(el);
    const link = box.find('a.name.browsinglink').first();
    const name = link.text().trim();
    const href = link.attr('href');
    if (!name || !href) return;

    const currentPrice = parseCzPrice(box.find('.js-price-box__primary-price__value').first().text());
    if (!currentPrice) return;

    // Every box here is already openbox (the condition filter did that), but
    // only some state the brand-new equivalent's price ("Nový 22 990,-") -
    // the rest get it from the reference price table, same as Datart.
    const originalText = box.find('.ads-pb__original-price').first().text();
    const ownOriginalPrice = /^\s*nov[ýy]/i.test(originalText) ? parseCzPrice(originalText) : null;

    items.push({
      site: 'alza',
      id: box.attr('data-id') || href,
      name,
      condition: null,
      url: href.startsWith('http') ? href : `${ORIGIN}${href}`,
      currentPrice,
      ownOriginalPrice,
      modelKey: modelKey(name),
    });
  });

  return items;
}

async function captureFilterRequest(page, base) {
  let captured = null;
  page.on('request', (req) => {
    if (!captured && req.url().includes(FILTER_ENDPOINT)) captured = req.postData();
  });

  await page.goto(base, { waitUntil: 'load', timeout: 60_000 });
  const title = await page.title();
  if (/okamžik|just a moment/i.test(title)) {
    // Cloudflare challenge - give it a few seconds to clear itself.
    await page.waitForFunction(() => !/okamžik|just a moment/i.test(document.title), null, { timeout: 30_000 });
  }

  // Changing the hash makes the page fire its own Filter call.
  await page.evaluate(() => { location.hash = 'f&pn=5'; });
  for (let i = 0; i < 20 && !captured; i++) await page.waitForTimeout(500);
  if (!captured) throw new Error('Alza page never made a Filter request - page layout may have changed');
  return JSON.parse(captured);
}

export async function fetchAlzaListings(startUrl) {
  const filter = parseFilterFromUrl(startUrl);
  const context = await launchBrowser();

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const template = await captureFilterRequest(page, filter.base);

    const items = [];
    let total = null;
    for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
      const body = {
        ...template,
        idCategory: filter.categoryId,
        commodityWears: filter.commodityWears,
        upperDescriptionStatus: filter.upperDescriptionStatus,
        producers: filter.producers,
        page: pageNo,
        pageTo: pageNo,
        append: false,
        counter: 1000 + pageNo,
      };

      const { status, text } = await page.evaluate(async ({ endpoint, body }) => {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' },
          body: JSON.stringify(body),
        });
        return { status: res.status, text: await res.text() };
      }, { endpoint: FILTER_ENDPOINT, body });
      if (status !== 200) throw new Error(`Alza Filter call failed with HTTP ${status} on page ${pageNo}`);

      const data = JSON.parse(text).d;
      total = data.Count;
      const pageItems = parseBoxes(data.Boxes || '');
      items.push(...pageItems);
      if (!pageItems.length || items.length >= total) break;
    }

    if (total != null && items.length < total) {
      console.warn(`Alza: Filter reported ${total} openbox listings but only ${items.length} were parsed`);
    }

    // The "Nový X Kč" an openbox listing states is the brand-new price for that
    // model+storage - harvest it into the reference table for listings
    // (here or on Datart) that don't state one.
    const newPriceReferences = items
      .filter((i) => i.modelKey && i.ownOriginalPrice)
      .map((i) => ({ key: i.modelKey, price: i.ownOriginalPrice }));

    return { items, newPriceReferences };
  } finally {
    await context.close();
  }
}
