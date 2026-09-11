-- Prix Traiteur : prix de vente spécifique au vendeur "Traiteur", distinct
-- du prix retail (products.sale_price). Si null, le prix retail est utilisé
-- comme prix Traiteur (pas de liste de prix Traiteur pour ce produit).
alter table products add column if not exists traiteur_price numeric(12,2);
