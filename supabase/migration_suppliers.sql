-- =====================================================================
-- Maakoulat — Migration "Fournisseurs enrichis" (additive)
-- À exécuter dans Supabase > SQL Editor APRÈS schema.sql. Idempotent.
-- Ajoute les coordonnées de contact aux fournisseurs pour la page dédiée
-- (CRUD complet + fiche fournisseur + relevé de compte).
-- =====================================================================

alter table suppliers add column if not exists phone        text;
alter table suppliers add column if not exists email        text;
alter table suppliers add column if not exists address      text;
alter table suppliers add column if not exists contact_name text;   -- personne à contacter
alter table suppliers add column if not exists notes        text;

-- (RLS déjà activée sur suppliers dans schema.sql — rien à ajouter.)
