-- Ejecutar en Supabase → SQL Editor (una sola vez por proyecto)
-- Documentación: https://supabase.com/docs/guides/auth/managing-user-data

create or replace function public.normalize_phone(phone text)
returns text
language sql
immutable
as $$
  select regexp_replace(coalesce(phone, ''), '\D', '', 'g');
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text not null,
  last_name text not null,
  phone text not null,
  phone_normalized text not null,
  restaurant_name text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists profiles_phone_normalized_key
  on public.profiles (phone_normalized);

alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

-- Perfil se crea solo desde el trigger (security definer)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb;
  p text;
  p_norm text;
  fn text;
  ln text;
  rn text;
begin
  meta := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  p := nullif(trim(coalesce(meta->>'phone', '')), '');
  if p is null then
    raise exception 'phone required in user metadata';
  end if;
  p_norm := public.normalize_phone(p);
  if length(p_norm) < 10 then
    raise exception 'invalid phone in user metadata';
  end if;

  fn := nullif(trim(coalesce(meta->>'first_name', '')), '');
  ln := nullif(trim(coalesce(meta->>'last_name', '')), '');
  rn := nullif(trim(coalesce(meta->>'restaurant_name', '')), '');
  if fn is null or ln is null or rn is null then
    raise exception 'first_name, last_name and restaurant_name required in user metadata';
  end if;

  insert into public.profiles (id, first_name, last_name, phone, phone_normalized, restaurant_name)
  values (new.id, fn, ln, p, p_norm, rn);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Tips:
-- 1) Authentication → Providers: habilitar Email.
-- 2) Para pruebas rápidas: Authentication → Sign In / Providers →
--    desactivar "Confirm email" o el usuario debe confirmar antes de entrar.
-- 3) Authentication → URL Configuration: Site URL coherente con tu deploy.
-- 4) Nunca expongas la service_role en el frontend. Vercel: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
--    (register + instant-login + resolve-email).
