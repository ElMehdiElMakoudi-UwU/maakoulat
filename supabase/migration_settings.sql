-- Paramètres modifiables depuis la page « Paramètres ».
--
-- • Réglages non sensibles (coordonnées société, expéditeur email, modèle du
--   message BC…) : table app_settings existante (clé/valeur).
-- • Secrets (mot de passe d'application Gmail) : table app_secrets, SANS
--   aucune policy RLS → illisible directement via l'API. On y accède
--   uniquement par les fonctions ci-dessous. Elle n'est pas incluse dans la
--   sauvegarde CSV et le mot de passe n'est jamais renvoyé à la page.

create table if not exists app_settings (
  key   text primary key,
  value text
);

create table if not exists app_secrets (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table app_secrets enable row level security;
-- Aucune policy : seul le propriétaire (fonctions security definer) y accède.

-- Liste blanche des clés de secret autorisées.
create or replace function app_secret_key_ok(p_key text) returns boolean
language sql immutable as $$
  select p_key in ('gmail_app_password');
$$;

-- Enregistre (ou efface si valeur vide) un secret.
create or replace function set_app_secret(p_key text, p_value text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if not app_secret_key_ok(p_key) then raise exception 'invalid key'; end if;
  if coalesce(trim(p_value), '') = '' then
    delete from app_secrets where key = p_key;
  else
    insert into app_secrets (key, value, updated_at) values (p_key, p_value, now())
      on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
end $$;

-- Indique si un secret est défini (sans le révéler).
create or replace function app_secret_status(p_key text)
returns table (is_set boolean, updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  return query
    select true, s.updated_at from app_secrets s where s.key = p_key
    union all
    select false, null::timestamptz
      where not exists (select 1 from app_secrets s where s.key = p_key);
end $$;

-- Lecture du secret — appelée côté serveur (route d'envoi d'email).
create or replace function get_app_secret(p_key text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if not app_secret_key_ok(p_key) then raise exception 'invalid key'; end if;
  return (select value from app_secrets where key = p_key);
end $$;

revoke all on function set_app_secret(text, text)  from public, anon;
revoke all on function app_secret_status(text)      from public, anon;
revoke all on function get_app_secret(text)         from public, anon;
grant execute on function set_app_secret(text, text) to authenticated;
grant execute on function app_secret_status(text)    to authenticated;
grant execute on function get_app_secret(text)       to authenticated;
