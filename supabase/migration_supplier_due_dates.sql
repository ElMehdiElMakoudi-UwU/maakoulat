-- =====================================================================
-- Maakoulat — Migration "Échéances fournisseurs" (additive)
-- À exécuter dans Supabase > SQL Editor APRÈS migration_finance.sql. Idempotent.
--
-- • suppliers.payment_terms_days : délai de paiement par défaut (0 = comptant)
-- • supplier_invoices.due_date   : date d'échéance de la commande / facture.
--   Si NULL, l'échéance est calculée = inv_date + délai du fournisseur.
--
-- Les paiements ne sont pas rattachés à une facture précise : ils soldent
-- les factures les plus anciennes en premier (FIFO), côté application.
-- =====================================================================

alter table suppliers         add column if not exists payment_terms_days int not null default 0;
alter table supplier_invoices add column if not exists due_date date;

create index if not exists idx_invoices_due_date on supplier_invoices(due_date);

-- (RLS déjà activée sur ces tables — rien à ajouter.)
