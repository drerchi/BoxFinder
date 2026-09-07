export function parseCzPrice(text) {
  if (!text) return null;
  const digits = text.replace(/[^\d]/g, '');
  if (!digits) return null;
  return parseInt(digits, 10);
}

export function discountPercent(originalPrice, currentPrice) {
  if (!originalPrice || !currentPrice || originalPrice <= currentPrice) return 0;
  return ((originalPrice - currentPrice) / originalPrice) * 100;
}
