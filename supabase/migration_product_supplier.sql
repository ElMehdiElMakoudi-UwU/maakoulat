-- =====================================================================
-- Maakoulat — Migration "Fournisseur par produit" (additive)
-- À exécuter dans Supabase > SQL Editor. Idempotent.
-- =====================================================================

alter table products
  add column if not exists supplier_id uuid references suppliers(id) on delete set null;

create index if not exists idx_products_supplier on products(supplier_id);

comment on column products.supplier_id is 'Fournisseur habituel du produit (optionnel)';
