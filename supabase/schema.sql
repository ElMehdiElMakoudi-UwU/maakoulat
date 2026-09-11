-- =====================================================================
-- Maakoulat — Schéma de base de données (Supabase / PostgreSQL)
-- =====================================================================
-- À exécuter dans Supabase > SQL Editor. Idempotent (peut être relancé).

-- ---------- Extensions ----------
create extension if not exists "pgcrypto";

-- ---------- Vendeurs ----------
create table if not exists sellers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text not null default 'retail' check (kind in ('retail','traiteur')),
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

-- ---------- Produits (catalogue partagé, commun à tous les vendeurs) ----------
create table if not exists products (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,               -- nom (souvent en arabe)
  category       text,                         -- ex: Fromages
  unit           text,                         -- ex: 1kg (surtout Traiteur)
  purchase_price numeric(12,2) not null default 0,   -- Prix Achat
  sale_price     numeric(12,2) not null default 0,   -- Prix Vente
  active         boolean not null default true,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now()
);

-- ---------- Ventes (une ligne = un produit vendu par un vendeur à une date) ----------
create table if not exists sales (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references products(id) on delete cascade,
  seller_id    uuid not null references sellers(id) on delete cascade,
  sale_date    date not null,
  quantity     numeric(12,2) not null default 0,
  -- prix figés au moment de la vente (pour l'historique même si le catalogue change)
  purchase_price numeric(12,2) not null default 0,
  sale_price     numeric(12,2) not null default 0,
  created_at   timestamptz not null default now(),
  unique (product_id, seller_id, sale_date)
);
create index if not exists idx_sales_seller_date on sales(seller_id, sale_date);
create index if not exists idx_sales_date on sales(sale_date);

-- ---------- Fournisseurs ----------
create table if not exists suppliers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

-- ---------- Paiements fournisseurs ----------
create table if not exists supplier_payments (
  id           uuid primary key default gen_random_uuid(),
  supplier_id  uuid not null references suppliers(id) on delete cascade,
  pay_date     date not null,
  amount       numeric(12,2) not null default 0,
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_payments_date on supplier_payments(pay_date);

-- ---------- Charges (charges fixes mensuelles) ----------
create table if not exists charges (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  amount      numeric(12,2) not null default 0,
  -- mois d'application au format 'YYYY-MM'; null = charge récurrente par défaut (modèle)
  month       text,
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists idx_charges_month on charges(month);

-- =====================================================================
-- Sécurité (RLS) : accès réservé aux utilisateurs authentifiés.
-- (Une seule entreprise : tout utilisateur connecté lit/écrit tout.)
-- =====================================================================
alter table sellers            enable row level security;
alter table products           enable row level security;
alter table sales              enable row level security;
alter table suppliers          enable row level security;
alter table supplier_payments  enable row level security;
alter table charges            enable row level security;

do $$
declare t text;
begin
  foreach t in array array['sellers','products','sales','suppliers','supplier_payments','charges']
  loop
    execute format('drop policy if exists "auth_all" on %I;', t);
    execute format(
      'create policy "auth_all" on %I for all to authenticated using (true) with check (true);', t);
  end loop;
end $$;
