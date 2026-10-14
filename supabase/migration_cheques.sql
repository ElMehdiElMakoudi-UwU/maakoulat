-- =====================================================================
-- Maakoulat — Migration "Chèques fournisseurs" (additive)
-- À exécuter dans Supabase > SQL Editor APRÈS migration_finance.sql. Idempotent.
--
-- Chèques remis aux fournisseurs, généralement post-datés :
--   • due_date : date inscrite sur le chèque (jour où il peut être débité)
--   • status   : pending (en circulation) → cashed (débité) | cancelled
-- Quand un chèque est marqué « débité », l'application crée (ou rattache)
-- le paiement fournisseur correspondant (payment_id) : la dette fournisseur
-- et la trésorerie restent cohérentes.
-- Les réglages du planificateur (CA/J par vendeur, jours de repos…) sont
-- stockés dans app_settings, clé 'cheque_planner' (JSON).
-- =====================================================================

create table if not exists supplier_cheques (
  id            uuid primary key default gen_random_uuid(),
  supplier_id   uuid not null references suppliers(id) on delete cascade,
  cheque_number text,
  amount        numeric(12,2) not null default 0,
  issue_date    date not null default current_date,
  due_date      date not null,
  status        text not null default 'pending' check (status in ('pending','cashed','cancelled')),
  payment_id    uuid references supplier_payments(id) on delete set null,
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_cheques_due_date on supplier_cheques(due_date);
create index if not exists idx_cheques_supplier on supplier_cheques(supplier_id);

alter table supplier_cheques enable row level security;
drop policy if exists "auth_all" on supplier_cheques;
create policy "auth_all" on supplier_cheques for all to authenticated using (true) with check (true);
