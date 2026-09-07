-- =====================================================================
-- Maakoulat — Migration "Gestion financière" (additive)
-- À exécuter dans Supabase > SQL Editor APRÈS schema.sql. Idempotent.
-- =====================================================================

-- ---------- Commandes / factures fournisseurs (ce qui est DÛ) ----------
-- Les paiements (supplier_payments) réduisent la dette :
--   reste à payer = Σ factures − Σ paiements
create table if not exists supplier_invoices (
  id           uuid primary key default gen_random_uuid(),
  supplier_id  uuid not null references suppliers(id) on delete cascade,
  inv_date     date not null,
  amount       numeric(12,2) not null default 0,
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_invoices_date on supplier_invoices(inv_date);
create index if not exists idx_invoices_supplier on supplier_invoices(supplier_id);

-- ---------- Objectifs & solde d'ouverture par mois ----------
create table if not exists monthly_settings (
  month           text primary key,          -- 'YYYY-MM'
  ca_target       numeric(12,2) not null default 0,
  profit_target   numeric(12,2) not null default 0,
  opening_balance numeric(12,2) not null default 0,  -- solde de trésorerie en début de mois
  created_at      timestamptz not null default now()
);

-- ---------- RLS : utilisateurs authentifiés ----------
alter table supplier_invoices enable row level security;
alter table monthly_settings  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['supplier_invoices','monthly_settings']
  loop
    execute format('drop policy if exists "auth_all" on %I;', t);
    execute format(
      'create policy "auth_all" on %I for all to authenticated using (true) with check (true);', t);
  end loop;
end $$;
