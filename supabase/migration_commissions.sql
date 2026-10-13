-- =====================================================================
-- Commissions vendeurs : un taux (%) par catégorie de produit.
-- Commission = Σ qté × prix de vente HT (figé sur la vente) × taux catégorie.
-- Seuls les vendeurs « retail » (Hamza, Mohamed) touchent une commission ;
-- le Traiteur n'en a pas. Idempotent.
-- =====================================================================

create table if not exists commission_rates (
  category    text primary key,                       -- = products.category (comparé sans casse ni espaces)
  rate        numeric(5,2) not null default 0 check (rate >= 0 and rate <= 100),
  updated_at  timestamptz not null default now()
);

alter table commission_rates enable row level security;
do $$
begin
  execute 'drop policy if exists "auth_all" on commission_rates';
  execute 'create policy "auth_all" on commission_rates for all to authenticated using (true) with check (true)';
end $$;

-- Taux initiaux : Fromages 1 %, Emballages 3 % (modifiables sur la page Charges)
insert into commission_rates (category, rate)
select distinct on (lower(trim(category))) trim(category),
       case when lower(trim(category)) like 'fromage%' then 1 else 3 end
from products
where lower(trim(category)) like 'fromage%' or lower(trim(category)) like 'emballage%'
on conflict (category) do nothing;
