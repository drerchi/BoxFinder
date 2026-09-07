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
