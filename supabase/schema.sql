drop table if exists openbox_deal_alerts;

create table if not exists openbox_products (
  id text primary key,               -- '<site>:<product id>'
  site text not null,
  name text not null,
  url text not null,
  last_price integer not null,
  last_original_price integer not null,
  last_discount_percent numeric not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Each kind of alert fires at most once ever per item, independently -
  -- a "new listing" ping and a "big discount" ping are different signals,
  -- so seeing one doesn't suppress the other, but neither repeats once sent.
  notified_new_at timestamptz,
  notified_discount_at timestamptz
);

-- Reference prices for brand-new iPhones, harvested from Alza's own
-- non-openbox listings each scan. Used as a fallback "original price" for
-- openbox listings (mainly on Datart) that don't state their own new-price
-- comparison, so a discount % can still be computed for them.
create table if not exists new_iphone_prices (
  model_key text primary key,        -- e.g. 'iphone-17-pro-max-256gb'
  price integer not null,
  updated_at timestamptz not null default now()
);

-- Runtime-editable config, read by the Edge Function at the start of every
-- scan (falls back to hardcoded defaults if a key is missing). Edited via the
-- control panel (docs/index.html on GitHub Pages).
create table if not exists settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

insert into settings (key, value) values
  ('alza_url', 'https://www.alza.cz/levne-iphone/18851638.htm#f&cst=2,3,1&cud=0&pg=1-2&pn=1&prod=&sc=4750'),
  ('datart_url', 'https://www.datart.cz/iphone.html/filter/o:3/v:-7:4:3:5:6'),
  ('discount_threshold_percent', '20')
on conflict (key) do nothing;

-- The control panel (docs/index.html, public on GitHub Pages) uses the anon
-- key, not service_role - scoped narrowly so a public page can't be used to
-- do more than edit these specific settings and read tracked items. Anyone
-- with the page URL can change alza_url/datart_url/discount_threshold_percent
-- this way (no auth on the page itself); nothing else is exposed.
alter table settings enable row level security;
alter table openbox_products enable row level security;

drop policy if exists "anon read settings" on settings;
create policy "anon read settings" on settings for select to anon using (true);
drop policy if exists "anon write settings" on settings;
create policy "anon write settings" on settings for insert to anon with check (true);
drop policy if exists "anon update settings" on settings;
create policy "anon update settings" on settings for update to anon using (true) with check (true);

drop policy if exists "anon read openbox_products" on openbox_products;
create policy "anon read openbox_products" on openbox_products for select to anon using (true);
