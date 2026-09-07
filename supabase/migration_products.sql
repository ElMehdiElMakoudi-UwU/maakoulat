-- =====================================================================
-- Maakoulat — Migration "Produits : désignation FR + TVA" (additive)
-- À exécuter dans Supabase > SQL Editor. Idempotent.
-- =====================================================================

alter table products add column if not exists name_fr  text;
alter table products add column if not exists vat_rate numeric(5,2) not null default 0;  -- TVA en %

comment on column products.name_fr  is 'Désignation en français (le nom principal reste souvent en arabe)';
comment on column products.vat_rate is 'Taux de TVA en pourcentage (ex: 20 = 20%)';
