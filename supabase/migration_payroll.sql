-- =====================================================================
-- Paie : salaire de base mensuel par vendeur (édité sur la page Paie).
-- Salaire du mois = salaire de base + commission (cf. commission_rates). Idempotent.
-- =====================================================================
alter table sellers add column if not exists base_salary numeric(12,2) not null default 0;

-- Salaire de base fixe : 2000 DH/mois pour les vendeurs retail (Hamza, Mohamed).
-- Ne touche pas un salaire déjà saisi ; le Traiteur reste à 0.
update sellers set base_salary = 2000 where kind = 'retail' and base_salary = 0;
