import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { Deal } from './telegram.ts';

const TABLE = 'openbox_products';
const PRICES_TABLE = 'new_iphone_prices';
const SETTINGS_TABLE = 'settings';

export interface ExistingRow {
  id: string;
  first_seen_at: string;
  notified_new_at: string | null;
  notified_discount_at: string | null;
}

export function createStore(supabaseUrl: string, supabaseKey: string) {
  const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey);

  return {
    async getSettings(): Promise<Record<string, string>> {
      const { data, error } = await supabase.from(SETTINGS_TABLE).select('key, value');
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((row: any) => [row.key, row.value]));
    },

    async isEmpty(): Promise<boolean> {
      const { count, error } = await supabase.from(TABLE).select('id', { count: 'exact', head: true });
      if (error) throw error;
      return count === 0;
    },

    async getExisting(id: string): Promise<ExistingRow | null> {
      const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      return data;
    },

    async upsertScan(id: string, item: Deal, existing: ExistingRow | null, notifiedNew: boolean, notifiedDiscount: boolean) {
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

    async getReferencePrices(): Promise<Map<string, number>> {
      const { data, error } = await supabase.from(PRICES_TABLE).select('model_key, price');
      if (error) throw error;
      return new Map((data ?? []).map((row: any) => [row.model_key, row.price]));
    },

    async upsertReferencePrices(entries: { key: string; price: number }[]) {
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
  };
}
