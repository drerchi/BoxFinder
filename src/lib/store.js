import { createClient } from '@supabase/supabase-js';

const TABLE = 'openbox_products';
const PRICES_TABLE = 'new_iphone_prices';
const SETTINGS_TABLE = 'settings';

export function createStore(supabaseUrl, supabaseKey) {
  const supabase = createClient(supabaseUrl, supabaseKey);

  return {
    async getSettings() {
      const { data, error } = await supabase.from(SETTINGS_TABLE).select('key, value');
      if (error) throw error;
      return Object.fromEntries(data.map((row) => [row.key, row.value]));
    },

    async getReferencePrices() {
      const { data, error } = await supabase.from(PRICES_TABLE).select('model_key, price');
      if (error) throw error;
      return new Map(data.map((row) => [row.model_key, row.price]));
    },

    async upsertReferencePrices(entries) {
      // entries: [{ key, price }] - dedupe by key first, last write wins.
      const byKey = new Map(entries.map(({ key, price }) => [key, price]));
      const rows = [...byKey.entries()].map(([model_key, price]) => ({
        model_key,
        price,
        updated_at: new Date().toISOString(),
      }));
      if (!rows.length) return;
      const { error } = await supabase.from(PRICES_TABLE).upsert(rows);
      if (error) throw error;
    },

    async isEmpty() {
      const { count, error } = await supabase.from(TABLE).select('id', { count: 'exact', head: true });
      if (error) throw error;
      return count === 0;
    },

    async getExisting(id) {
      const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      return data;
    },

    async upsertScan(id, item, existing, notifiedNew, notifiedDiscount) {
      const now = new Date().toISOString();
      const { error } = await supabase.from(TABLE).upsert({
        id,
        site: item.site,
        name: item.name,
        url: item.url,
        last_price: item.currentPrice,
        last_original_price: item.originalPrice,
        last_discount_percent: item.discountPercent,
        first_seen_at: existing?.first_seen_at ?? now,
        last_seen_at: now,
        notified_new_at: notifiedNew ? now : existing?.notified_new_at ?? null,
        notified_discount_at: notifiedDiscount ? now : existing?.notified_discount_at ?? null,
      });
      if (error) throw error;
    },
  };
}
