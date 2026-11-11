-- =====================================================================
-- Maakoulat — Migration "Dossier comptable mensuel" (additive, idempotente)
-- À exécuter dans Supabase > SQL Editor, APRÈS migration_bank.sql,
-- migration_sales_invoices.sql et migration_tva.sql.
--
-- Process du mois N-1 :
--  1. Registre des factures d'achat  ← débits du relevé (chèques fournisseurs)
--     un taux de TVA par facture (20 %, 10 %, 0 %…), TTC = montant payé.
--  2. Registre des factures de vente ← crédits du relevé (versements espèce,
--     virements…), un taux par facture (20 % ou 0 %) choisi pour équilibrer
--     TVA collectée ≈ TVA déductible.
--  3. Lignes de chaque facture de vente générées depuis les ventes réelles
--     du mois (produits du même taux, quantités plafonnées).
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------- 1. Factures d'achat ----------
create table if not exists purchase_invoices (
  id                  uuid primary key default gen_random_uuid(),
  month               text not null,                                   -- 'YYYY-MM' (dossier)
  inv_date            date not null,
  supplier_id         uuid references suppliers(id) on delete set null,
  supplier_name       text,                                            -- figé
  ref                 text,                                            -- n° facture fournisseur (optionnel)
  amount_ttc          numeric(14,2) not null default 0,
  vat_rate            numeric(5,2) not null default 20,
  payment_mode        text not null default 'cheque'
                        check (payment_mode in ('cheque','virement','espece','effet','prelevement')),
  cheque_number       text,
  due_date            date,
  bank_transaction_id uuid references bank_transactions(id) on delete set null,
  note                text,
  sort_order          int not null default 0,
  created_at          timestamptz not null default now()
);
create index if not exists idx_pinv_month on purchase_invoices(month);
create unique index if not exists uq_pinv_bank_tx on purchase_invoices(bank_transaction_id)
  where bank_transaction_id is not null;

alter table purchase_invoices enable row level security;
drop policy if exists "auth_all" on purchase_invoices;
create policy "auth_all" on purchase_invoices for all to authenticated using (true) with check (true);

-- ---------- 2. Registre des ventes : colonnes ajoutées aux factures ----------
alter table sales_invoices add column if not exists vat_rate numeric(5,2);           -- taux unique de la facture
alter table sales_invoices add column if not exists payment_mode text;                -- 'espece','virement','cheque'…
alter table sales_invoices add column if not exists bank_transaction_id uuid
  references bank_transactions(id) on delete set null;
alter table sales_invoices add column if not exists source text;                      -- 'dossier' (nouveau process) / null (ancienne ventilation)

-- PU HT à 3 décimales : permet d'atteindre exactement le TTC de la facture
alter table sales_invoice_items alter column unit_price type numeric(12,3);
