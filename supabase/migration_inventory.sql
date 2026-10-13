-- =====================================================================
-- Maakoulat — Migration "Inventaire" (additive)
-- À exécuter dans Supabase > SQL Editor. Idempotent.
--
-- Un inventaire = l'ensemble des lignes ayant la même count_date.
-- unit_cost est figé à la saisie (prix d'achat HT du produit à ce moment),
-- pour que la valeur d'un inventaire passé ne change pas quand les prix
-- d'achat évoluent.
-- =====================================================================

create table if not exists inventory_counts (
  id          uuid primary key default gen_random_uuid(),
  count_date  date not null,
  product_id  uuid not null references products(id) on delete cascade,
  quantity    numeric(12,3) not null default 0,
  unit_cost   numeric(12,2) not null default 0,  -- prix d'achat HT figé
  created_at  timestamptz not null default now(),
  unique (count_date, product_id)
);
create index if not exists idx_inventory_date on inventory_counts(count_date);

alter table inventory_counts enable row level security;
drop policy if exists "auth_all" on inventory_counts;
create policy "auth_all" on inventory_counts for all to authenticated using (true) with check (true);
