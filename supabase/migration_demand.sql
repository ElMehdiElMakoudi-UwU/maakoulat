-- =====================================================================
-- Maakoulat — Migration "Prévision de la demande & saisonnalité"
-- À exécuter dans Supabase > SQL Editor. Idempotent (peut être relancé).
-- =====================================================================
-- • sales_history        : historique de ventes importé (Excel) — séparé de `sales`
--                          pour ne pas fausser le CA, la ventilation ni les factures.
--                          Une ligne = quantité vendue d'un produit sur une période
--                          (un jour : period_start = period_end ; un mois : 1er → dernier jour).
-- • demand_seasons       : saisons (Ramadan, Été, Aïd, vacances…)
-- • demand_season_periods: occurrences datées de chaque saison (une par année)
-- • demand_coefficients  : coefficients saisis manuellement (priment sur les coefficients appris)

create extension if not exists "pgcrypto";

-- ---------- Historique de ventes importé ----------
create table if not exists sales_history (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,
  seller_kind   text not null default 'retail' check (seller_kind in ('retail','traiteur')),
  period_start  date not null,
  period_end    date not null,
  quantity      numeric(12,2) not null default 0,
  created_at    timestamptz not null default now(),
  check (period_end >= period_start),
  unique (product_id, seller_kind, period_start, period_end)
);
create index if not exists idx_sales_history_start on sales_history(period_start);

-- ---------- Saisons ----------
create table if not exists demand_seasons (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,                 -- ex: 'Ramadan'
  lead_days   int not null default 0,               -- la demande monte N jours avant le début
  auto_kind   text check (auto_kind in ('ramadan','eid_adha','summer')), -- dates générables automatiquement
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists demand_season_periods (
  id          uuid primary key default gen_random_uuid(),
  season_id   uuid not null references demand_seasons(id) on delete cascade,
  start_date  date not null,
  end_date    date not null,
  check (end_date >= start_date),
  unique (season_id, start_date)
);

-- ---------- Coefficients manuels ----------
-- Portée : product_id renseigné → ce produit ; sinon category renseignée → cette catégorie ;
-- sinon → tous les produits. seller_kind null → retail ET traiteur.
create table if not exists demand_coefficients (
  id           uuid primary key default gen_random_uuid(),
  season_id    uuid not null references demand_seasons(id) on delete cascade,
  product_id   uuid references products(id) on delete cascade,
  category     text,
  seller_kind  text check (seller_kind in ('retail','traiteur')),
  coefficient  numeric(6,3) not null check (coefficient > 0)
);
create unique index if not exists uq_demand_coef_scope on demand_coefficients
  (season_id, coalesce(product_id::text, ''), coalesce(category, ''), coalesce(seller_kind, ''));

-- ---------- Saisons par défaut ----------
insert into demand_seasons (name, lead_days, auto_kind, sort_order) values
  ('Ramadan', 7, 'ramadan', 1),
  ('Aïd al-Adha', 5, 'eid_adha', 2),
  ('Été', 0, 'summer', 3),
  ('Vacances scolaires', 0, null, 4)
on conflict (name) do nothing;

-- =====================================================================
-- Sécurité (RLS)
-- =====================================================================
alter table sales_history          enable row level security;
alter table demand_seasons         enable row level security;
alter table demand_season_periods  enable row level security;
alter table demand_coefficients    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['sales_history','demand_seasons','demand_season_periods','demand_coefficients']
  loop
    execute format('drop policy if exists "auth_all" on %I;', t);
    execute format(
      'create policy "auth_all" on %I for all to authenticated using (true) with check (true);', t);
  end loop;
end $$;
