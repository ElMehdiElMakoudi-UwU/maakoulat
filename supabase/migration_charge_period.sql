-- =====================================================================
-- Maakoulat — Migration "Période des charges fixes" (additive)
-- À exécuter dans Supabase > SQL Editor. Idempotent.
--
-- start_month / end_month ('YYYY-MM', inclus ; NULL = sans limite) :
-- une charge fixe terminée (ex. traite d'un crédit soldé) reçoit un
-- end_month au lieu d'être supprimée → les mois passés restent justes.
-- =====================================================================
alter table charges add column if not exists start_month text;
alter table charges add column if not exists end_month   text;
