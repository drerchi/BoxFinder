export function parseCzPrice(text: string | null | undefined): number | null {
  if (!text) return null;
  const digits = text.replace(/[^\d]/g, '');
  if (!digits) return null;
  const value = parseInt(digits, 10);
  // Datart occasionally shows a literal "0 Kč" for a comparison price it
  // hasn't synced yet (a site data glitch, not a real price) - treat it as
  // missing rather than a nonsensical original price, so the reference-price
  // fallback kicks in instead.
  return value > 0 ? value : null;
}

export function discountPercent(originalPrice: number, currentPrice: number): number {
  if (!originalPrice || !currentPrice || originalPrice <= currentPrice) return 0;
  return ((originalPrice - currentPrice) / originalPrice) * 100;
}
