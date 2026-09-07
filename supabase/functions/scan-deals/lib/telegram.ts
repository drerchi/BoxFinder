export interface Deal {
  site: 'alza' | 'datart';
  id: string;
  name: string;
  url: string;
  currentPrice: number;
  originalPrice: number;
  discountPercent: number;
  condition?: string | null;
}

export async function sendTelegramMessage(botToken: string, chatId: string, text: string) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(`Telegram sendMessage failed: ${JSON.stringify(data)}`);
  }
  return data;
}

export function formatDealMessage(item: Deal, tags: string[] = ['discount']): string {
  const site = item.site === 'alza' ? 'Alza' : 'Datart';
  const condition = item.condition ? ` (${item.condition})` : '';

  const badges: string[] = [];
  if (tags.includes('new')) badges.push('🆕 Nová nabídka');
  if (tags.includes('discount')) badges.push('📉 Velká sleva');

  // Always show original price + current price + discount% when we have a
  // comparable original price (own or from the new-iPhone reference table) -
  // only truly missing (no strike price on the site, no reference match) for
  // items priceSource === 'none', where originalPrice falls back to currentPrice.
  const hasComparablePrice = item.originalPrice > item.currentPrice;
  const priceLine = hasComparablePrice
    ? `${item.currentPrice.toLocaleString('cs-CZ')} Kč <s>${item.originalPrice.toLocaleString('cs-CZ')} Kč</s> (−${item.discountPercent.toFixed(0)}%)`
    : `${item.currentPrice.toLocaleString('cs-CZ')} Kč`;

  return `${badges.join(' · ')} na ${site}${condition}\n` + `<a href="${item.url}">${item.name}</a>\n` + priceLine;
}
