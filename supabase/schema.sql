create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  display_name text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 100),
  season text not null default '',
  host text not null default '',
  venue text not null default '',
  city text not null default '',
  country text not null default '',
  start_date date,
  end_date date,
  invite_code text not null unique,
  owner_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create table if not exists public.tournament_members (
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('admin', 'scorer', 'viewer')),
  joined_at timestamptz not null default now(),
  primary key (tournament_id, user_id)
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  title text not null default '',
  team_a text not null check (length(trim(team_a)) between 1 and 80),
  team_b text not null check (length(trim(team_b)) between 1 and 80),
  format text not null check (format in ('test', 'odi', 't20')),
  overs integer,
  venue text not null default '',
  scheduled_at timestamptz,
  assigned_scorer uuid not null references public.profiles (id),
  status text not null default 'scheduled' check (status in ('scheduled', 'live', 'innings-break', 'complete')),
  score_state jsonb,
  state_version integer not null default 0,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((format = 'test' and overs is null) or (format <> 'test' and overs between 1 and 50)),
  check (lower(team_a) <> lower(team_b))
);

create or replace function public.prevent_viewer_with_active_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'viewer' and exists (
    select 1 from public.matches m
    where m.tournament_id = new.tournament_id
      and m.assigned_scorer = new.user_id
      and m.status <> 'complete'
  ) then
    raise exception 'Reassign this member’s active matches before changing them to viewer.';
  end if;
  return new;
end;
$$;

drop trigger if exists cricnova_preserve_assigned_scorer on public.tournament_members;
create trigger cricnova_preserve_assigned_scorer
before update of role on public.tournament_members
for each row execute function public.prevent_viewer_with_active_match();

create index if not exists tournament_members_user_id_idx on public.tournament_members (user_id);
create index if not exists matches_tournament_status_idx on public.matches (tournament_id, status, scheduled_at);

create or replace function public.is_tournament_member(target_tournament uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.tournament_members tm
    where tm.tournament_id = target_tournament and tm.user_id = auth.uid()
  );
$$;

create or replace function public.is_tournament_admin(target_tournament uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.tournament_members tm
    where tm.tournament_id = target_tournament and tm.user_id = auth.uid() and tm.role = 'admin'
  );
$$;

revoke all on function public.is_tournament_member(uuid) from public;
revoke all on function public.is_tournament_admin(uuid) from public;
grant execute on function public.is_tournament_member(uuid) to authenticated;
grant execute on function public.is_tournament_admin(uuid) to authenticated;

create or replace function public.create_profile_for_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'name', ''))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists cricnova_auth_user_profile on auth.users;
create trigger cricnova_auth_user_profile
after insert or update of email on auth.users
for each row execute function public.create_profile_for_user();

insert into public.profiles (id, email, display_name)
select id, coalesce(email, ''), coalesce(raw_user_meta_data ->> 'name', '')
from auth.users
on conflict (id) do update set email = excluded.email;

create or replace function public.add_tournament_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tournament_members (tournament_id, user_id, role)
  values (new.id, new.owner_id, 'admin')
  on conflict (tournament_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists cricnova_tournament_owner on public.tournaments;
create trigger cricnova_tournament_owner
after insert on public.tournaments
for each row execute function public.add_tournament_owner();

create or replace function public.join_tournament(code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in before joining a tournament.';
  end if;

  select id into target_id
  from public.tournaments
  where invite_code = upper(trim(code));

  if target_id is null then
    raise exception 'That tournament invite code is not valid.';
  end if;

  insert into public.tournament_members (tournament_id, user_id, role)
  values (target_id, auth.uid(), 'scorer')
  on conflict (tournament_id, user_id) do nothing;

  return target_id;
end;
$$;

revoke all on function public.join_tournament(text) from public;
grant execute on function public.join_tournament(text) to authenticated;

create or replace function public.update_match_score(
  target_match uuid,
  expected_version integer,
  next_state jsonb,
  next_status text
)
returns table (score_state jsonb, state_version integer, status text, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_match public.matches%rowtype;
begin
  select * into current_match
  from public.matches
  where id = target_match
  for update;

  if current_match.id is null then
    raise exception 'Match not found.';
  end if;

  if current_match.assigned_scorer is distinct from auth.uid() then
    raise exception 'Only the assigned scorer can score this match. Ask a tournament admin to reassign it.';
  end if;

  if not exists (
    select 1 from public.tournament_members tm
    where tm.tournament_id = current_match.tournament_id
      and tm.user_id = auth.uid()
      and tm.role in ('admin', 'scorer')
  ) then
    raise exception 'Your tournament role does not allow scoring this match.';
  end if;

  if expected_version is null or current_match.state_version <> expected_version then
    raise exception 'This scorecard changed elsewhere. Reload the latest match before continuing.'
      using errcode = '40001';
  end if;

  update public.matches
  set score_state = next_state,
      status = next_status,
      state_version = current_match.state_version + 1,
      updated_at = now()
  where id = target_match
  returning public.matches.score_state, public.matches.state_version, public.matches.status, public.matches.updated_at
  into score_state, state_version, status, updated_at;

  return next;
end;
$$;

revoke all on function public.update_match_score(uuid, integer, jsonb, text) from public;
grant execute on function public.update_match_score(uuid, integer, jsonb, text) to authenticated;

alter table public.profiles enable row level security;
alter table public.tournaments enable row level security;
alter table public.tournament_members enable row level security;
alter table public.matches enable row level security;

drop policy if exists profiles_self_or_tournament on public.profiles;
create policy profiles_self_or_tournament on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or exists (
    select 1
    from public.tournament_members mine
    join public.tournament_members theirs on theirs.tournament_id = mine.tournament_id
    where mine.user_id = auth.uid() and theirs.user_id = profiles.id
  )
);

drop policy if exists tournament_members_read on public.tournament_members;
create policy tournament_members_read on public.tournament_members
for select to authenticated
using (public.is_tournament_member(tournament_id));

drop policy if exists tournament_members_admin_manage on public.tournament_members;
create policy tournament_members_admin_manage on public.tournament_members
for all to authenticated
using (public.is_tournament_admin(tournament_id))
with check (public.is_tournament_admin(tournament_id));

drop policy if exists tournaments_read on public.tournaments;
create policy tournaments_read on public.tournaments
for select to authenticated
using (public.is_tournament_member(id));

drop policy if exists tournaments_create on public.tournaments;
create policy tournaments_create on public.tournaments
for insert to authenticated
with check (owner_id = auth.uid());

drop policy if exists tournaments_admin_update on public.tournaments;
create policy tournaments_admin_update on public.tournaments
for update to authenticated
using (public.is_tournament_admin(id))
with check (public.is_tournament_admin(id));

drop policy if exists tournaments_admin_delete on public.tournaments;
create policy tournaments_admin_delete on public.tournaments
for delete to authenticated
using (public.is_tournament_admin(id));

drop policy if exists matches_tournament_read on public.matches;
create policy matches_tournament_read on public.matches
for select to authenticated
using (public.is_tournament_member(tournament_id));

drop policy if exists matches_admin_insert on public.matches;
create policy matches_admin_insert on public.matches
for insert to authenticated
with check (
  public.is_tournament_admin(tournament_id)
  and created_by = auth.uid()
  and (assigned_scorer is null or exists (
    select 1 from public.tournament_members tm
    where tm.tournament_id = matches.tournament_id
      and tm.user_id = matches.assigned_scorer
      and tm.role in ('admin', 'scorer')
  ))
);

drop policy if exists matches_admin_update on public.matches;
create policy matches_admin_update on public.matches
for update to authenticated
using (public.is_tournament_admin(tournament_id))
with check (
  public.is_tournament_admin(tournament_id)
  and (assigned_scorer is null or exists (
    select 1 from public.tournament_members tm
    where tm.tournament_id = matches.tournament_id
      and tm.user_id = matches.assigned_scorer
      and tm.role in ('admin', 'scorer')
  ))
);

drop policy if exists matches_admin_delete on public.matches;
create policy matches_admin_delete on public.matches
for delete to authenticated
using (public.is_tournament_admin(tournament_id));

grant select on public.profiles, public.tournaments, public.tournament_members, public.matches to authenticated;
grant insert, update, delete on public.tournaments to authenticated;
grant insert, delete on public.tournament_members to authenticated;
grant update (role) on public.tournament_members to authenticated;
grant insert, delete on public.matches to authenticated;
revoke update on public.matches from authenticated;
grant update (title, team_a, team_b, format, overs, venue, scheduled_at, assigned_scorer)
  on public.matches to authenticated;

-- In Supabase, enable Realtime for public.matches in Database > Publications.
