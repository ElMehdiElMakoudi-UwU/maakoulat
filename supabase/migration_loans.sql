-- =====================================================================
-- Maakoulat — Migration "Crédits bancaires" (additive)
-- À exécuter dans Supabase > SQL Editor. Idempotent.
--
-- Un crédit = une mensualité fixe prélevée chaque mois à partir du mois de
-- first_due_date, pendant duration_months mois, le jour payment_day
-- (propre à chaque crédit ; NULL = jour de first_due_date ; ramené à la fin
-- du mois si besoin, ex. 31 → 30/28).
--   • Les échéances passées sont considérées comme prélevées.
--   • Les échéances à venir des crédits actifs sont prises en compte par
--     le planificateur de chèques (/cheques) comme des débits du matin.
--   • interest_rate (annuel, %) est optionnel : il sert au tableau
--     d'amortissement (capital / intérêts / capital restant dû).
-- =====================================================================

create table if not exists bank_loans (
  id               uuid primary key default gen_random_uuid(),
  bank             text not null default '',
  label            text not null default '',
  principal        numeric(12,2) not null default 0,   -- montant emprunté
  interest_rate    numeric(6,3) not null default 0,    -- taux annuel %
  monthly_payment  numeric(12,2) not null default 0,   -- mensualité prélevée
  first_due_date   date not null,                      -- date de la 1re échéance
  payment_day      int check (payment_day between 1 and 31), -- jour de prélèvement de ce crédit
  duration_months  int not null default 12 check (duration_months > 0),
  status           text not null default 'active' check (status in ('active','closed')),
  note             text,
  created_at       timestamptz not null default now()
);

alter table bank_loans add column if not exists payment_day int check (payment_day between 1 and 31);

alter table bank_loans enable row level security;
drop policy if exists "auth_all" on bank_loans;
create policy "auth_all" on bank_loans for all to authenticated using (true) with check (true);
