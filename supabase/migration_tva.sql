-- =====================================================================
-- Maakoulat — Migration "Récapitulatif TVA" (additive)
-- À exécuter dans Supabase > SQL Editor. Idempotent.
--
-- • supplier_invoices.vat_rate : taux de TVA de la facture fournisseur
--   (montant saisi = TTC ; TVA déductible = TTC × taux / (100 + taux)).
--   null = taux non renseigné (signalé sur la page TVA).
-- • charges.vat_rate : idem pour les charges (null = pas de TVA / non renseigné).
-- • tva_declarations : une ligne par période déclarée ('YYYY-MM' ou 'YYYY-T1'..'T4'),
--   montants figés au moment de la déclaration ; le crédit de TVA d'une période
--   est reporté automatiquement sur la suivante.
-- =====================================================================

alter table supplier_invoices add column if not exists vat_rate numeric(5,2);
alter table charges           add column if not exists vat_rate numeric(5,2);

create table if not exists tva_declarations (
  period        text primary key,                      -- '2026-09' ou '2026-T3'
  collected     numeric(14,2) not null default 0,      -- TVA collectée
  deductible    numeric(14,2) not null default 0,      -- TVA déductible
  credit_in     numeric(14,2) not null default 0,      -- crédit reporté de la période précédente
  result        numeric(14,2) not null default 0,      -- > 0 : TVA due ; < 0 : crédit à reporter
  declared_on   date not null default current_date,
  paid_on       date,
  note          text,
  created_at    timestamptz not null default now()
);

alter table tva_declarations enable row level security;
drop policy if exists "auth_all" on tva_declarations;
create policy "auth_all" on tva_declarations for all to authenticated using (true) with check (true);
