import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Persistent profile so Cloudflare's clearance cookies survive between runs -
// a fresh profile every time gets challenged more often.
const PROFILE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.browser-profile');

// Alza's Cloudflare blocks headless Chrome outright (403 "Okamžik…" challenge
// page), but lets a normal headed Chrome through. Run headed, with the window
// parked off-screen so a scheduled run doesn't pop up over whatever you're
// doing - works the same while the screen is locked.
export async function launchBrowser() {
  return chromium.launchPersistentContext(PROFILE_DIR, {
    channel: process.env.BROWSER_CHANNEL || 'chrome',
    headless: false,
    locale: 'cs-CZ',
    viewport: { width: 1366, height: 900 },
    args: ['--window-position=-32000,-32000', '--no-first-run', '--no-default-browser-check'],
  });
}
