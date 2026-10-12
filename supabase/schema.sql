-- =============================================================================
-- Brown Line IL LLC: Supabase database schema
-- =============================================================================
--
-- How to run: Supabase Dashboard -> SQL Editor -> New query -> paste this whole
-- file -> Run. Running it again later is safe: it only creates what is missing
-- and refreshes functions, triggers, views and policies.
--
-- Additions beyond the original spec (all deliberate):
--   profiles.email, profiles.created_at   contact details for the dispatch manifest
--   rentals.terms_version,
--   rentals.terms_accepted_at             proof the customer accepted the liability terms
--   rentals.created_at                    ordering and audit
--   invoices.deposit_note,
--   invoices.deposit_refund_id,
--   invoices.deposit_resolved_at          audit trail for released or seized deposits
--   invoice_counters                      gap-free BL-IL-YYYY-00001 numbering per year
--   rental_manifest (view)                rentals + invoice + customer in one row
--
-- Security model:
--   * Row-level security is on for every table.
--   * Customers read their own profile, rentals and invoices, and may insert
--     their own profile and rentals (auth.uid() = user_id).
--   * Invoices are written only by the server using the Supabase secret key,
--     so no customer can set their own price.
--   * Admins (profiles.role = 'admin') can read and change everything.
--   * Nobody can promote themselves: the role column cannot be written through
--     the public API. Make someone an admin from the SQL editor (see README).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Enum types
-- -----------------------------------------------------------------------------

do $$ begin
  create type public.user_role as enum ('customer', 'admin', 'driver');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.rental_status as enum ('pending_delivery', 'active', 'scheduled_pickup', 'completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.unit_category as enum ('standard_construction', 'deluxe_event', 'ada_compliant', 'handwashing_station');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.pay_status as enum ('unpaid', 'paid', 'overdue', 'refunded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.deposit_status as enum ('held', 'released', 'forfeited_damage');
exception when duplicate_object then null; end $$;


-- -----------------------------------------------------------------------------
-- 2. Tables
-- -----------------------------------------------------------------------------

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  full_name    text,
  company_name text,
  phone_number text,
  email        text,
  role         public.user_role not null default 'customer',
  created_at   timestamptz not null default now()
);

create table if not exists public.rentals (
  id                uuid primary key default gen_random_uuid(),
  -- "restrict" keeps financial records: a customer with bookings can't be
  -- deleted by accident.
  user_id           uuid not null references public.profiles (id) on delete restrict,
  status            public.rental_status not null default 'pending_delivery',
  unit_category     public.unit_category not null,
  quantity          integer not null,
  delivery_address  text not null,
  event_type        text not null,
  start_date        date not null,
  end_date          date not null,
  terms_version     text not null,
  terms_accepted_at timestamptz not null,
  created_at        timestamptz not null default now(),
  constraint rentals_end_date_after_start check (end_date >= start_date),
  constraint rentals_quantity_range check (quantity between 1 and 50),
  constraint rentals_address_length check (char_length(delivery_address) between 5 and 300),
  constraint rentals_event_type_length check (char_length(event_type) between 2 and 80)
);

create index if not exists rentals_user_id_idx on public.rentals (user_id);
create index if not exists rentals_status_start_idx on public.rentals (status, start_date);

-- One counter row per calendar year (America/Chicago) for invoice numbers.
create table if not exists public.invoice_counters (
  year       integer primary key,
  last_value integer not null default 0
);

create table if not exists public.invoices (
  -- Assigned automatically on insert: BL-IL-<year>-<5+ digit sequence>.
  id                  text primary key,
  rental_id           uuid not null unique references public.rentals (id) on delete restrict,
  stripe_intent_id    text unique,
  amount_base         numeric(10, 2) not null,
  amount_deposit      numeric(10, 2) not null default 50.00,
  -- 10.25% Cook County rental tax on amount_base, calculated by the server.
  amount_tax          numeric(10, 2) not null,
  amount_total        numeric(10, 2) generated always as (amount_base + amount_deposit + amount_tax) stored,
  pay_status          public.pay_status not null default 'unpaid',
  dep_status          public.deposit_status not null default 'held',
  issued_at           timestamptz not null default now(),
  paid_at             timestamptz,
  deposit_note        text,
  -- Stripe refund id once the deposit is released ('pending' while the
  -- refund is on its way, so the deposit can't also be kept for damage).
  deposit_refund_id   text,
  deposit_resolved_at timestamptz,
  constraint invoices_id_format check (id ~ '^BL-IL-[0-9]{4}-[0-9]{5,}$'),
  constraint invoices_amount_base_positive check (amount_base > 0),
  constraint invoices_amount_tax_nonnegative check (amount_tax >= 0),
  constraint invoices_deposit_fixed check (amount_deposit = 50.00),
  constraint invoices_deposit_needs_payment check (dep_status = 'held' or pay_status in ('paid', 'refunded'))
);

create index if not exists invoices_pay_dep_status_idx on public.invoices (pay_status, dep_status);

comment on column public.invoices.amount_tax is '10.25% Cook County rental tax on amount_base';
comment on column public.invoices.amount_deposit is 'Mandatory refundable security deposit, fixed at $50.00';


-- -----------------------------------------------------------------------------
-- 3. Helper functions and triggers
-- -----------------------------------------------------------------------------

-- True when the signed-in user is an admin. SECURITY DEFINER so it can read
-- profiles without tripping the profiles policies (avoids recursion).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  );
$$;

-- Next invoice number, e.g. BL-IL-2026-00042. The counter row is locked for
-- the rest of the transaction, so numbers are unique and have no gaps.
create or replace function public.next_invoice_id()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year integer := extract(year from (now() at time zone 'America/Chicago'))::integer;
  v_seq  integer;
begin
  insert into public.invoice_counters as c (year, last_value)
  values (v_year, 1)
  on conflict (year) do update set last_value = c.last_value + 1
  returning c.last_value into v_seq;

  return 'BL-IL-' || v_year::text || '-' ||
    case when v_seq < 100000 then lpad(v_seq::text, 5, '0') else v_seq::text end;
end;
$$;

create or replace function public.assign_invoice_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.id := public.next_invoice_id();
  return new;
end;
$$;

drop trigger if exists invoices_assign_id on public.invoices;
create trigger invoices_assign_id
  before insert on public.invoices
  for each row execute function public.assign_invoice_id();

-- When an invoice becomes paid (Stripe or a manual edit in the dashboard),
-- stamp paid_at and move the rental from pending_delivery to active in the
-- same transaction.
create or replace function public.on_invoice_paid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.pay_status = 'paid' and old.pay_status is distinct from 'paid' then
    if new.paid_at is null then
      new.paid_at := now();
    end if;
    update public.rentals
       set status = 'active'
     where id = new.rental_id
       and status = 'pending_delivery';
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_on_paid on public.invoices;
create trigger invoices_on_paid
  before update of pay_status on public.invoices
  for each row execute function public.on_invoice_paid();

-- Create a profile for every new sign-up. The role is never read from the
-- sign-up metadata (the user controls that), so everyone starts as customer.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, company_name, phone_number)
  values (
    new.id,
    new.email,
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'company_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'phone_number'), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep profiles.email in step when a user changes their email address.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

-- Profiles for anyone who signed up before this script was run.
insert into public.profiles (id, email, full_name, company_name, phone_number)
select
  u.id,
  u.email,
  nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
  nullif(btrim(u.raw_user_meta_data ->> 'company_name'), ''),
  nullif(btrim(u.raw_user_meta_data ->> 'phone_number'), '')
from auth.users u
on conflict (id) do nothing;


-- -----------------------------------------------------------------------------
-- 4. Server-only functions (called by the site's server with the secret key)
-- -----------------------------------------------------------------------------

-- Creates the rental and its invoice in one transaction and returns the new
-- invoice id. Prices are calculated by the server, never by the browser.
create or replace function public.create_booking(
  p_user_id          uuid,
  p_unit_category    public.unit_category,
  p_quantity         integer,
  p_delivery_address text,
  p_event_type       text,
  p_start_date       date,
  p_end_date         date,
  p_terms_version    text,
  p_amount_base      numeric,
  p_amount_tax       numeric
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rental_id  uuid;
  v_invoice_id text;
begin
  insert into public.rentals (
    user_id, status, unit_category, quantity, delivery_address, event_type,
    start_date, end_date, terms_version, terms_accepted_at
  )
  values (
    p_user_id, 'pending_delivery', p_unit_category, p_quantity, p_delivery_address, p_event_type,
    p_start_date, p_end_date, p_terms_version, now()
  )
  returning id into v_rental_id;

  insert into public.invoices (rental_id, amount_base, amount_deposit, amount_tax)
  values (v_rental_id, round(p_amount_base, 2), 50.00, round(p_amount_tax, 2))
  returning id into v_invoice_id;

  return v_invoice_id;
end;
$$;

-- Marks an invoice paid after the server has verified the payment with Stripe.
-- The invoices_on_paid trigger flips the rental to active in the same
-- transaction. Safe to call more than once; returns the resulting pay_status.
create or replace function public.mark_invoice_paid(p_invoice_id text, p_intent_id text)
returns public.pay_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
begin
  select * into v_invoice
    from public.invoices
   where id = p_invoice_id
   for update;

  if not found then
    raise exception 'Invoice % not found', p_invoice_id using errcode = 'P0002';
  end if;

  if v_invoice.stripe_intent_id is distinct from p_intent_id then
    raise exception 'Payment % does not belong to invoice %', p_intent_id, p_invoice_id
      using errcode = '22023';
  end if;

  if v_invoice.pay_status in ('unpaid', 'overdue') then
    update public.invoices set pay_status = 'paid' where id = p_invoice_id;
    return 'paid';
  end if;

  return v_invoice.pay_status;
end;
$$;

-- Headline numbers for the admin dashboard, computed in the database so they
-- stay correct no matter how many invoices exist.
create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;

  return jsonb_build_object(
    -- Rental revenue from paid invoices plus deposits kept for damage
    -- (tax and refundable deposits are not earnings).
    'gross_earnings',
      coalesce((select sum(i.amount_base) from public.invoices i where i.pay_status = 'paid'), 0)
      + coalesce((select sum(i.amount_deposit) from public.invoices i
                   where i.pay_status = 'paid' and i.dep_status = 'forfeited_damage'), 0),
    'units_in_field',
      coalesce((select sum(r.quantity) from public.rentals r
                 where r.status in ('active', 'scheduled_pickup')), 0),
    'jobs_in_field',
      (select count(*) from public.rentals r where r.status in ('active', 'scheduled_pickup')),
    'deposits_held',
      coalesce((select sum(i.amount_deposit) from public.invoices i
                 where i.pay_status = 'paid' and i.dep_status = 'held'), 0),
    'deposits_held_count',
      (select count(*) from public.invoices i where i.pay_status = 'paid' and i.dep_status = 'held'),
    -- Picked up and closed out, but nobody has refunded or kept the deposit yet.
    'deposits_ready_count',
      (select count(*) from public.invoices i
         join public.rentals r on r.id = i.rental_id
        where i.pay_status = 'paid' and i.dep_status = 'held' and r.status = 'completed'),
    'unpaid_count',
      (select count(*) from public.invoices i where i.pay_status in ('unpaid', 'overdue'))
  );
end;
$$;


-- -----------------------------------------------------------------------------
-- 5. Manifest view (rental + invoice + customer). security_invoker makes the
--    view obey the row-level security of the tables underneath it.
-- -----------------------------------------------------------------------------

create or replace view public.rental_manifest
with (security_invoker = on) as
select
  r.id                  as rental_id,
  r.user_id,
  r.status,
  r.unit_category,
  r.quantity,
  r.delivery_address,
  r.event_type,
  r.start_date,
  r.end_date,
  r.created_at,
  p.full_name,
  p.company_name,
  p.phone_number,
  p.email,
  i.id                  as invoice_id,
  i.amount_base,
  i.amount_deposit,
  i.amount_tax,
  i.amount_total,
  i.pay_status,
  i.dep_status,
  i.issued_at,
  i.paid_at,
  i.deposit_note,
  i.deposit_resolved_at
from public.rentals r
join public.invoices i on i.rental_id = r.id
left join public.profiles p on p.id = r.user_id;


-- -----------------------------------------------------------------------------
-- 6. Row-level security
-- -----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.rentals enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_counters enable row level security;  -- no policies: functions only

-- profiles
drop policy if exists profiles_select_own_or_admin on public.profiles;
create policy profiles_select_own_or_admin on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()) and role = 'customer');

drop policy if exists profiles_update_own_or_admin on public.profiles;
create policy profiles_update_own_or_admin on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()))
  with check (id = (select auth.uid()) or (select public.is_admin()));

-- rentals
drop policy if exists rentals_select_own_or_admin on public.rentals;
create policy rentals_select_own_or_admin on public.rentals
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists rentals_insert_own on public.rentals;
create policy rentals_insert_own on public.rentals
  for insert to authenticated
  with check (
    (user_id = (select auth.uid()) and status = 'pending_delivery')
    or (select public.is_admin())
  );

drop policy if exists rentals_update_admin on public.rentals;
create policy rentals_update_admin on public.rentals
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists rentals_delete_admin on public.rentals;
create policy rentals_delete_admin on public.rentals
  for delete to authenticated
  using ((select public.is_admin()));

-- invoices: customers read the invoices for their own rentals; only admins
-- (or the server's secret key, which bypasses RLS) can write.
drop policy if exists invoices_select_own_or_admin on public.invoices;
create policy invoices_select_own_or_admin on public.invoices
  for select to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.rentals r
      where r.id = invoices.rental_id and r.user_id = (select auth.uid())
    )
  );

drop policy if exists invoices_admin_write on public.invoices;
create policy invoices_admin_write on public.invoices
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));


-- -----------------------------------------------------------------------------
-- 7. Privileges
-- -----------------------------------------------------------------------------

-- Supabase normally grants these by default. They're spelled out so the site
-- also works where those defaults were turned off; row-level security (above)
-- still decides which rows anyone can see or change.
grant usage on schema public to authenticated, service_role;
grant select on table public.profiles to authenticated;
grant select, insert, update, delete on table public.rentals, public.invoices to authenticated;
grant all on table public.profiles, public.rentals, public.invoices, public.invoice_counters to service_role;
grant select on table public.rental_manifest to authenticated, service_role;

-- Row-level security doesn't apply to these, so signed-in users don't get them.
revoke truncate, references, trigger on table public.profiles, public.rentals, public.invoices, public.invoice_counters from authenticated;

-- Signed-out visitors get nothing.
revoke all on table public.profiles, public.rentals, public.invoices, public.invoice_counters from anon;
revoke all on table public.rental_manifest from anon;

-- Signed-in users can only write these profile columns (never role or email).
revoke insert, update on table public.profiles from authenticated;
grant insert (id, full_name, company_name, phone_number) on table public.profiles to authenticated;
grant update (full_name, company_name, phone_number) on table public.profiles to authenticated;

-- Functions: lock down everything that isn't meant to be called from a browser.
revoke all on function public.next_invoice_id() from public, anon, authenticated;
revoke all on function public.assign_invoice_id() from public, anon, authenticated;
revoke all on function public.on_invoice_paid() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.handle_user_email_change() from public, anon, authenticated;
revoke all on function public.create_booking(uuid, public.unit_category, integer, text, text, date, date, text, numeric, numeric) from public, anon, authenticated;
revoke all on function public.mark_invoice_paid(text, text) from public, anon, authenticated;
revoke all on function public.admin_dashboard_stats() from public, anon;
revoke all on function public.is_admin() from public, anon;

grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.admin_dashboard_stats() to authenticated, service_role;
grant execute on function public.create_booking(uuid, public.unit_category, integer, text, text, date, date, text, numeric, numeric) to service_role;
grant execute on function public.mark_invoice_paid(text, text) to service_role;
grant execute on function public.next_invoice_id() to service_role;


-- -----------------------------------------------------------------------------
-- 8. Realtime: the admin dashboard listens for changes to these tables.
-- -----------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.rentals;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.invoices;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
