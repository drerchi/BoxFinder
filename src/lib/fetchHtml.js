import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'cs-CZ,cs;q=0.9',
    },
  });
  if (!res.ok) {
    throw new Error(`Fetch failed ${res.status} ${res.statusText} for ${url}`);
  }
  return res.text();
}

// Alza's Cloudflare bot-management blocks Node's fetch (undici) client with a
// 403 based on its TLS/HTTP fingerprint, while curl is let through unaffected.
// Shell out to curl for Alza specifically. This requires a curl binary on the
// host, which won't be true inside a Deno-based Supabase Edge Function - if
// this runs there instead of a Node host, this needs a different bypass.
export async function fetchHtmlViaCurl(url) {
  const { stdout } = await execFileAsync('curl', [
    '-s',
    '-A', USER_AGENT,
    '-H', 'Accept-Language: cs-CZ,cs;q=0.9',
    '--fail',
    url,
  ], { maxBuffer: 20 * 1024 * 1024 });
  return stdout;
}
