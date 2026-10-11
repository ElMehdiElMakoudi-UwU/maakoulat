-- =====================================================================
-- Primes sur CA : paliers fixés chaque mois pour chaque vendeur.
-- Si le CA HT du vendeur sur le mois atteint un seuil, il touche la prime
-- du PLUS HAUT palier atteint (non cumulatif). Idempotent.
-- =====================================================================
create table if not exists seller_bonus_tiers (
  id          uuid primary key default gen_random_uuid(),
  month       text not null,                                   -- 'YYYY-MM'
  seller_id   uuid not null references sellers(id) on delete cascade,
  threshold   numeric(12,2) not null check (threshold > 0),    -- CA HT à atteindre
  bonus       numeric(12,2) not null default 0 check (bonus >= 0),
  created_at  timestamptz not null default now(),
  unique (month, seller_id, threshold)
);
create index if not exists idx_bonus_tiers_month on seller_bonus_tiers(month);

alter table seller_bonus_tiers enable row level security;
do $$
begin
  execute 'drop policy if exists "auth_all" on seller_bonus_tiers';
  execute 'create policy "auth_all" on seller_bonus_tiers for all to authenticated using (true) with check (true)';
end $$;

-- Paliers de départ pour octobre 2026 (vendeurs retail) : 230 000 → 400, 260 000 → 900, 280 000 → 1 800.
-- Modifiables sur la page Paie ; « Copier le mois précédent » pour les mois suivants.
insert into seller_bonus_tiers (month, seller_id, threshold, bonus)
select '2026-10', s.id, t.threshold, t.bonus
from sellers s
cross join (values (230000, 400), (260000, 900), (280000, 1800)) as t(threshold, bonus)
where s.kind = 'retail'
on conflict (month, seller_id, threshold) do nothing;
