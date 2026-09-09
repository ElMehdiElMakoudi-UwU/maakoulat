-- =====================================================================
-- Maakoulat — Migration "Clients" (facturation, étape 2)
-- À exécuter dans Supabase > SQL Editor APRÈS schema.sql. Idempotent.
-- =====================================================================
-- Les clients servent à la ventilation mensuelle des encaissements
-- (étape 3) et à la génération des factures (étape 4).
--   wants_invoice  : ce client veut une facture (les autres = "au comptant")
--   discount_rate  : remise en % sur le prix catalogue (0 = plein tarif)

create table if not exists clients (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  ice            text,                                  -- Identifiant Commun de l'Entreprise
  if_num         text,                                  -- Identifiant Fiscal
  rc             text,                                  -- Registre de Commerce
  address        text,
  phone          text,
  email          text,
  contact_name   text,
  wants_invoice  boolean not null default true,
  discount_rate  numeric(5,2) not null default 0,       -- % de remise sur le PU catalogue
  notes          text,
  active         boolean not null default true,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists idx_clients_active on clients(active);

alter table clients enable row level security;
do $$
begin
  execute 'drop policy if exists "auth_all" on clients';
  execute 'create policy "auth_all" on clients for all to authenticated using (true) with check (true)';
end $$;
