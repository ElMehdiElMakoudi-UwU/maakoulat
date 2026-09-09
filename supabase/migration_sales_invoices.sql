-- =====================================================================
-- Maakoulat — Migration "Factures de vente" (facturation, étape 4)
-- À exécuter dans Supabase > SQL Editor APRÈS migration_ventilation.sql. Idempotent.
-- =====================================================================
-- Les factures sont générées à partir du pool mensuel (ventes réelles) et
-- des objectifs par client (ventilation_targets). Numérotation séquentielle
-- continuant le registre Excel (voir app_settings.invoice_start_number).

create extension if not exists "pgcrypto";

-- ---------- Réglages applicatifs (clé/valeur) ----------
create table if not exists app_settings (
  key   text primary key,
  value text
);
insert into app_settings (key, value) values ('invoice_start_number', '120')
  on conflict (key) do nothing;

-- ---------- En-tête facture ----------
create table if not exists sales_invoices (
  id            uuid primary key default gen_random_uuid(),
  inv_number    int,                                    -- n° attribué à la finalisation
  month         text not null,                          -- 'YYYY-MM' (mois du pool / rattachement)
  client_id     uuid references clients(id) on delete set null,
  client_name   text,                                   -- figé au moment de la génération
  client_ice    text,
  client_if     text,
  client_address text,
  inv_date      date not null default current_date,
  target_ttc    numeric(14,2) not null default 0,       -- objectif issu de la ventilation
  discount_rate numeric(5,2) not null default 0,        -- remise client figée
  status        text not null default 'draft' check (status in ('draft','final')),
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_sinv_month on sales_invoices(month);
create unique index if not exists uq_sinv_number on sales_invoices(inv_number) where inv_number is not null;

-- ---------- Lignes facture ----------
create table if not exists sales_invoice_items (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references sales_invoices(id) on delete cascade,
  product_id   uuid references products(id) on delete set null,
  designation  text not null,                           -- figée
  unit         text,
  quantity     numeric(12,2) not null default 0,
  unit_price   numeric(12,2) not null default 0,        -- PU HT (remise déjà appliquée)
  vat_rate     numeric(5,2) not null default 0,
  sort_order   int not null default 0
);
create index if not exists idx_sitems_invoice on sales_invoice_items(invoice_id);

-- ---------- RLS ----------
alter table app_settings         enable row level security;
alter table sales_invoices       enable row level security;
alter table sales_invoice_items  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['app_settings','sales_invoices','sales_invoice_items']
  loop
    execute format('drop policy if exists "auth_all" on %I;', t);
    execute format(
      'create policy "auth_all" on %I for all to authenticated using (true) with check (true);', t);
  end loop;
end $$;
