export function parseCzPrice(text: string | null | undefined): number | null {
  if (!text) return null;
  const digits = text.replace(/[^\d]/g, '');
  if (!digits) return null;
  return parseInt(digits, 10);
}

export function discountPercent(originalPrice: number, currentPrice: number): number {
  if (!originalPrice || !currentPrice || originalPrice <= currentPrice) return 0;
  return ((originalPrice - currentPrice) / originalPrice) * 100;
}
