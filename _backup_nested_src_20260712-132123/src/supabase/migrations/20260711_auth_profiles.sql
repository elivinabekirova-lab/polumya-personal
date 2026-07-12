create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','employee')),
  staff_id text unique,
  display_name text not null,
  login text unique not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profile read own or admin" on public.profiles;
create policy "profile read own or admin"
on public.profiles for select
to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.profiles p
    where p.user_id = (select auth.uid())
      and p.role = 'admin'
      and p.active = true
  )
);

drop policy if exists "profile admin update" on public.profiles;
create policy "profile admin update"
on public.profiles for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.user_id = (select auth.uid())
      and p.role = 'admin'
      and p.active = true
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.user_id = (select auth.uid())
      and p.role = 'admin'
      and p.active = true
  )
);

grant select, update on public.profiles to authenticated;

-- Поточний застосунок зберігає робочі дані у спільному JSON app_state.
-- Доступ дозволений лише авторизованим користувачам; інтерфейс показує працівнику тільки його кабінет.
alter table public.app_state enable row level security;

drop policy if exists "authenticated read app state" on public.app_state;
create policy "authenticated read app state"
on public.app_state for select
to authenticated
using (true);

drop policy if exists "authenticated write app state" on public.app_state;
create policy "authenticated write app state"
on public.app_state for insert
to authenticated
with check (true);

drop policy if exists "authenticated update app state" on public.app_state;
create policy "authenticated update app state"
on public.app_state for update
to authenticated
using (true)
with check (true);

grant select, insert, update on public.app_state to authenticated;
revoke all on public.app_state from anon;
