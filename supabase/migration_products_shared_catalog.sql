-- =====================================================================
-- Maakoulat — Migration "Catalogue produits partagé" (destructive : à valider)
-- À exécuter dans Supabase > SQL Editor. Idempotent.
--
-- Avant : chaque produit appartenait à un seul vendeur (products.seller_id),
-- donc un produit créé pendant que "Hamza" était sélectionné n'apparaissait
-- jamais pour les autres vendeurs.
-- Après : un seul catalogue de produits, partagé par tous les vendeurs.
-- Les ventes (table sales) gardent leur propre seller_id : on sait toujours
-- quel vendeur a vendu quoi, à quelle date.
-- =====================================================================

-- La contrainte d'unicité des ventes doit désormais inclure le vendeur,
-- puisque plusieurs vendeurs peuvent vendre le même produit le même jour.
alter table sales drop constraint if exists sales_product_id_sale_date_key;
alter table sales add constraint sales_product_id_seller_id_sale_date_key
  unique (product_id, seller_id, sale_date);

drop index if exists idx_products_seller;
alter table products drop column if exists seller_id;
