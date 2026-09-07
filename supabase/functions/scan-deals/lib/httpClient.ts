const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Alza (Cloudflare) and Datart (F5/Shape) both block requests from Supabase's
// datacenter IP range outright, even with normal browser headers - confirmed
// via live testing (403 from Alza, a JS bot-challenge page from Datart).
// Route through ScraperAPI (residential/rotating IPs) when a key is
// configured; falls back to a direct fetch for local dev, where a home IP
// isn't blocked.
export async function fetchHtml(url: string): Promise<string> {
  const apiKey = Deno.env.get('SCRAPERAPI_KEY');

  const target = apiKey
    ? `https://api.scraperapi.com/?api_key=${apiKey}&url=${encodeURIComponent(url)}`
    : url;

  const res = await fetch(
    target,
    apiKey ? {} : { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'cs-CZ,cs;q=0.9' } }
  );
  if (!res.ok) {
    throw new Error(`Fetch failed ${res.status} ${res.statusText} for ${url}`);
  }
  return res.text();
}
