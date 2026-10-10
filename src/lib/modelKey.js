const GEN_PATTERN = /iphone\s+(\d+e?|air|se)/i;
const VARIANT_PATTERN = /(pro\s*max|pro|plus|mini)/i;
const STORAGE_PATTERN = /(\d+)\s*(gb|tb)/i;

// Normalizes an iPhone product name (Alza's short form or Datart's verbose
// "Mobilní telefon Apple iPhone X ... (part-number) - condition - warranty"
// form) down to a "model+storage" key, e.g. "iphone-17-pro-max-256gb",
// ignoring color, condition, part number, and other free text.
export function modelKey(name) {
  if (!name) return null;

  const genMatch = name.match(GEN_PATTERN);
  if (!genMatch) return null;
  const gen = genMatch[1].toLowerCase().replace(/\s+/g, '');

  const afterGen = name.slice(genMatch.index + genMatch[0].length);
  const variantMatch = afterGen.match(VARIANT_PATTERN);
  const variant = variantMatch ? variantMatch[1].toLowerCase().replace(/\s+/g, '-') : null;

  const storageMatch = name.match(STORAGE_PATTERN);
  if (!storageMatch) return null;
  const storage = `${storageMatch[1]}${storageMatch[2].toLowerCase()}`;

  return ['iphone', gen, variant, storage].filter(Boolean).join('-');
}

// True if the name is an iPhone at or above `minGeneration` (e.g. 16 keeps
// 16/16e/17/18/Air, drops 15 and older and SE). Names that don't parse as an
// iPhone at all are kept - better a stray alert than a silently dropped deal.
export function isWantedGeneration(name, minGeneration) {
  const genMatch = name?.match(GEN_PATTERN);
  if (!genMatch) return true;
  const gen = genMatch[1].toLowerCase();
  if (gen === 'air') return true;
  if (gen === 'se') return false;
  return parseInt(gen, 10) >= minGeneration;
}
