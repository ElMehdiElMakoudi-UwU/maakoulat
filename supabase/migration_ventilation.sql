-- =====================================================================
-- Maakoulat — Migration "Ventilation des encaissements" (facturation, étape 3)
-- À exécuter dans Supabase > SQL Editor APRÈS migration_clients.sql. Idempotent.
-- =====================================================================
-- Pour un mois : on répartit le total encaissé (relevé bancaire) entre
-- les clients qui veulent une facture ; le reste = "au comptant".
--   monthly_ventilation : le total encaissé du mois (auto depuis la banque, ou saisi)
--   ventilation_targets : le montant TTC à facturer par client pour ce mois

create table if not exists monthly_ventilation (
  month               text primary key,                 -- 'YYYY-MM'
  encaissement_total  numeric(14,2) not null default 0,
  auto_encaissement   boolean not null default true,     -- true = recalculé depuis bank_transactions
  note                text,
  updated_at          timestamptz not null default now()
);

create table if not exists ventilation_targets (
  id          uuid primary key default gen_random_uuid(),
  month       text not null,                             -- 'YYYY-MM'
  client_id   uuid not null references clients(id) on delete cascade,
  target_ttc  numeric(14,2) not null default 0,
  created_at  timestamptz not null default now(),
  unique (month, client_id)
);
create index if not exists idx_vt_month on ventilation_targets(month);

alter table monthly_ventilation  enable row level security;
alter table ventilation_targets  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['monthly_ventilation','ventilation_targets']
  loop
    execute format('drop policy if exists "auth_all" on %I;', t);
    execute format(
      'create policy "auth_all" on %I for all to authenticated using (true) with check (true);', t);
  end loop;
end $$;
