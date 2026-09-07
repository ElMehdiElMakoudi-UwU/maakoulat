-- =====================================================================
-- Maakoulat — Migration "Bons de commande" (achats fournisseurs)
-- À exécuter dans Supabase > SQL Editor. Idempotent (peut être relancé).
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------- En-tête du bon de commande ----------
create table if not exists purchase_orders (
  id           uuid primary key default gen_random_uuid(),
  bc_number    text,                                   -- ex: "33-24"
  supplier_id  uuid references suppliers(id) on delete set null,
  order_date   date not null default current_date,
  vat_rate     numeric(5,2) not null default 20,       -- TVA en %
  status       text not null default 'draft'
                 check (status in ('draft','sent','received')),
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_po_date on purchase_orders(order_date);

-- ---------- Lignes du bon de commande ----------
create table if not exists purchase_order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references purchase_orders(id) on delete cascade,
  unit         text,                                   -- ex: "1 kg"
  designation  text not null,                          -- désignation produit
  quantity     numeric(12,2) not null default 0,
  unit_price   numeric(12,2) not null default 0,       -- P.U. HT
  sort_order   int not null default 0
);
create index if not exists idx_po_items_order on purchase_order_items(order_id);

-- =====================================================================
-- Sécurité (RLS)
-- =====================================================================
alter table purchase_orders       enable row level security;
alter table purchase_order_items  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['purchase_orders','purchase_order_items']
  loop
    execute format('drop policy if exists "auth_all" on %I;', t);
    execute format(
      'create policy "auth_all" on %I for all to authenticated using (true) with check (true);', t);
  end loop;
end $$;

-- =====================================================================
-- Import initial : le "BC MODEL" (n° 33-24) — inséré une seule fois.
-- =====================================================================
do $$
declare bc_id uuid;
begin
  if not exists (select 1 from purchase_orders) then
    insert into purchase_orders (bc_number, order_date, vat_rate, status)
      values ('33-24', current_date, 20, 'draft')
      returning id into bc_id;

    insert into purchase_order_items (order_id, unit, designation, quantity, unit_price, sort_order) values
    (bc_id, '1 kg', 'Top chef  Mozzarel BLOC  blanc  1 kg', 300, 39.17, 0),
    (bc_id, '1kg', 'Top chef  Mozzarel rapé  blanc  1 kg', 50, 40.17, 1),
    (bc_id, '1 kg', 'Top chef  Mozzarel PREMIUM  BLOC blanc  1 kg', 30, 41.67, 2),
    (bc_id, '250g', 'Top chef  Mozzarel rape  blanc  250 G', 160, 10.63, 3),
    (bc_id, '1 kg', 'Top chef  Mozzarel BLOC  blanc  200 G', 200, 8.33, 4),
    (bc_id, '1KG', 'Top chef  EDAM BLOC 1KG', 70, 42.5, 5),
    (bc_id, '1KG', 'Top chef  EDAM rapé 1KG', 40, 43.5, 6),
    (bc_id, '1 kg', 'Mamie zakia  rapé 1 kg', 100, 45, 7),
    (bc_id, '1 kg', 'mozzarel mozzarel bloc 1Kg', 40, 32.5, 8),
    (bc_id, '200 G', 'mozzarel mozzarel bloc  200 g', 1250, 6.88, 9),
    (bc_id, '200g', 'mozzarel mozzarel rape  200 g', 160, 7.29, 10),
    (bc_id, '90 g', 'mozzarel mozzarel bloc  90 g', 330, 3.54, 11),
    (bc_id, '90 g', 'Top chef impérial rouge 90 G', 800, 5.83, 12),
    (bc_id, '1,5 kg', 'Top chef impérial rouge 1,500 KG', 36, 82.5, 13),
    (bc_id, '900G', 'Top chef impérial rouge 900 g', 18, 52.17, 14),
    (bc_id, '2KG', 'BNINASOS KETCHUO   2 KG', 120, 11.67, 15),
    (bc_id, '2 KG', 'BNINASOS Mayonnaise   2 KG', 36, 20.83, 16),
    (bc_id, '2KG', 'BNINASOS PIQUNTE   2 KG', 60, 14.7, 17),
    (bc_id, '2KG', 'DELISOS MAYONNAISE 2KG', 60, 24.58, 18),
    (bc_id, '2 KG', 'DELISOS piqunte 2KG', 60, 17.5, 19),
    (bc_id, '2KG', 'DELISOS KETCHUP 2KG', 120, 14.17, 20);
  end if;
end $$;
