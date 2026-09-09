-- =====================================================================
-- Maakoulat — Migration "Banque" (relevés de compte + rapprochement)
-- À exécuter dans Supabase > SQL Editor APRÈS schema.sql + migration_finance.sql.
-- Idempotent (peut être relancé).
-- =====================================================================
-- Étape 1 du chantier "Facturation" :
--   1) importer le relevé bancaire PDF (Attijariwafa) ou saisie manuelle
--   2) rapprocher chaque paiement chèque d'un fournisseur (crée un
--      supplier_payments, ce qui met à jour les dettes fournisseurs)
--   3) les encaissements (versements espèce) alimenteront la ventilation
--      des ventes (étape 3).

create extension if not exists "pgcrypto";

-- ---------- Relevé importé (un import = un fichier / une période) ----------
create table if not exists bank_statements (
  id              uuid primary key default gen_random_uuid(),
  filename        text,
  period_start    date,
  period_end      date,
  opening_balance numeric(14,2) not null default 0,   -- solde départ (signé, + = créditeur)
  closing_balance numeric(14,2) not null default 0,   -- solde final (signé)
  total_debit     numeric(14,2) not null default 0,   -- "TOTAL MOUVEMENTS" débit (déclaré)
  total_credit    numeric(14,2) not null default 0,   -- "TOTAL MOUVEMENTS" crédit (déclaré)
  tx_count        int not null default 0,
  imported_at     timestamptz not null default now()
);
create index if not exists idx_bank_statements_period on bank_statements(period_start);

-- ---------- Lignes du relevé (mouvements) ----------
create table if not exists bank_transactions (
  id            uuid primary key default gen_random_uuid(),
  statement_id  uuid references bank_statements(id) on delete cascade,
  op_date       date not null,                        -- date opération
  value_date    date,                                 -- date valeur
  label         text not null,                        -- libellé brut du relevé
  op_ref        text,                                 -- code opération / réf (ex "043412", "CHEQUE N 0010917")
  -- montant signé : négatif = débit (sortie), positif = crédit (entrée)
  amount        numeric(14,2) not null default 0,
  direction     text not null check (direction in ('debit','credit')),
  -- catégorie métier (modifiable par l'utilisateur)
  kind          text not null default 'autre'
                  check (kind in ('encaissement','paiement_frs','apport','charge','autre')),
  charge_cat    text,                                 -- si kind='charge' : 'impots','cnss','leasing','assurance','frais_bancaires','credit','autre'
  supplier_id   uuid references suppliers(id) on delete set null,
  reconciled    boolean not null default false,       -- rapproché (paiement fournisseur créé)
  payment_id    uuid references supplier_payments(id) on delete set null,
  note          text,
  fingerprint   text not null,                        -- déduplication à l'import
  created_at    timestamptz not null default now()
);
create unique index if not exists uq_bank_tx_fingerprint on bank_transactions(fingerprint);
create index if not exists idx_bank_tx_op_date on bank_transactions(op_date);
create index if not exists idx_bank_tx_kind on bank_transactions(kind);
create index if not exists idx_bank_tx_supplier on bank_transactions(supplier_id);

-- Lien retour depuis un paiement fournisseur vers la ligne de relevé d'origine
alter table supplier_payments
  add column if not exists bank_transaction_id uuid references bank_transactions(id) on delete set null;

-- ---------- RLS : utilisateurs authentifiés ----------
alter table bank_statements    enable row level security;
alter table bank_transactions  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['bank_statements','bank_transactions']
  loop
    execute format('drop policy if exists "auth_all" on %I;', t);
    execute format(
      'create policy "auth_all" on %I for all to authenticated using (true) with check (true);', t);
  end loop;
end $$;
