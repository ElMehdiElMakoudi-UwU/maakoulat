-- =====================================================================
-- Paie : salaire de base mensuel par vendeur (édité sur la page Paie).
-- Salaire du mois = salaire de base + commission (cf. commission_rates). Idempotent.
-- =====================================================================
alter table sellers add column if not exists base_salary numeric(12,2) not null default 0;
