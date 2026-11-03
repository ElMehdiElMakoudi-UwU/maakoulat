-- =====================================================================
-- Maakoulat — Migration "Flotte de véhicules" (additive)
-- À exécuter dans Supabase > SQL Editor. Idempotent.
--
-- vehicles      : un véhicule + ses échéances administratives
--                 (assurance, vignette, visite technique) et sa consommation.
-- vehicle_logs  : journal (plein de carburant, vidange, pneus, freins,
--                 réparation, autre). Un entretien peut porter une prochaine
--                 échéance (date et/ou kilométrage) : c'est la dernière ligne
--                 de chaque type qui sert de rappel sur /flotte.
-- =====================================================================

create table if not exists vehicles (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null default '',          -- ex. "Camion Isuzu"
  plate                 text not null default '',          -- immatriculation
  model                 text,
  year                  int,
  fuel_type             text not null default 'diesel' check (fuel_type in ('diesel','essence')),
  consumption_l100      numeric(5,2) not null default 10,  -- L/100 km
  mileage_km            int not null default 0,            -- compteur actuel
  driver                text,
  insurer               text,
  insurance_policy      text,
  insurance_expiry      date,
  insurance_cost        numeric(12,2) not null default 0,  -- prime annuelle
  vignette_expiry       date,
  vignette_cost         numeric(12,2) not null default 0,  -- annuel
  inspection_expiry     date,                              -- visite technique
  status                text not null default 'active' check (status in ('active','inactive')),
  note                  text,
  created_at            timestamptz not null default now()
);

create table if not exists vehicle_logs (
  id             uuid primary key default gen_random_uuid(),
  vehicle_id     uuid not null references vehicles(id) on delete cascade,
  kind           text not null default 'other'
                 check (kind in ('fuel','oil','tires','brakes','repair','other')),
  log_date       date not null,
  mileage_km     int,
  cost           numeric(12,2) not null default 0,
  liters         numeric(8,2),          -- pleins uniquement
  next_due_date  date,                  -- prochaine échéance (entretien)
  next_due_km    int,
  note           text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_vehicle_logs_vehicle on vehicle_logs(vehicle_id, log_date);

alter table vehicles     enable row level security;
alter table vehicle_logs enable row level security;

do $$
declare t text;
begin
  foreach t in array array['vehicles','vehicle_logs']
  loop
    execute format('drop policy if exists "auth_all" on %I;', t);
    execute format(
      'create policy "auth_all" on %I for all to authenticated using (true) with check (true);', t);
  end loop;
end $$;
