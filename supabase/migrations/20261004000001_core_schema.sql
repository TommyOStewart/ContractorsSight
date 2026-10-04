-- Core domain schema.
--
-- Conventions
--   * Tables are plural snake_case; TypeScript maps them to camelCase.
--   * Every domain row carries org_id. Child rows reference parents with composite
--     foreign keys (parent_id, org_id) so a row can never point into another org,
--     even if application code has a bug.
--   * Money is integer cents in bigint *_cents columns.
--   * Enum values mirror packages/shared/src/domain/enums.ts (checked by a unit test).

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.job_status as enum (
  'lead', 'quoted', 'accepted', 'scheduled', 'in_progress', 'completed', 'invoiced', 'paid', 'declined', 'cancelled'
);
create type public.material_status as enum ('needed', 'ordered', 'purchased', 'installed', 'returned');
create type public.quote_status as enum ('draft', 'sent', 'accepted', 'rejected', 'superseded');
create type public.quote_line_kind as enum ('labor', 'material');
create type public.supply_integration_type as enum ('email', 'api', 'manual');
create type public.supply_order_status as enum ('draft', 'sent', 'confirmed', 'received', 'cancelled');
create type public.capture_type as enum ('audio', 'image', 'text');
create type public.capture_status as enum ('uploaded', 'processing', 'ready_for_review', 'committed', 'rejected', 'failed');
create type public.change_set_status as enum ('pending', 'approved', 'rejected');
create type public.audit_source as enum ('manual', 'voice', 'image', 'text', 'system');
create type public.org_role as enum ('owner', 'admin', 'member');

-- ---------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------

create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Organizations and users
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- App-level user data. Identity and credentials live in auth.users.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.org_members (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.org_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index org_members_user_id_idx on public.org_members (user_id);

-- ---------------------------------------------------------------------------
-- Clients, sites, equipment
-- ---------------------------------------------------------------------------

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  phone text,
  email text,
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id)
);
create index clients_org_id_idx on public.clients (org_id);
create index clients_name_trgm_idx on public.clients using gin (name extensions.gin_trgm_ops);

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  client_id uuid not null,
  label text,
  line1 text not null,
  line2 text,
  city text,
  region text,
  postal_code text,
  access_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  unique (id, client_id),
  foreign key (client_id, org_id) references public.clients (id, org_id) on delete cascade
);
create index sites_client_id_idx on public.sites (client_id);

create table public.equipment (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  site_id uuid not null,
  kind text not null, -- e.g. 'water heater', 'softener', 'sump pump'
  manufacturer text,
  model text,
  serial_number text,
  installed_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (site_id, org_id) references public.sites (id, org_id) on delete cascade
);
create index equipment_site_id_idx on public.equipment (site_id);

-- ---------------------------------------------------------------------------
-- Jobs and the status state machine
-- ---------------------------------------------------------------------------

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  client_id uuid not null,
  site_id uuid,
  title text not null check (length(trim(title)) > 0),
  job_type text check (job_type = lower(trim(job_type)) and length(job_type) > 0),
  description text,
  status public.job_status not null default 'lead',
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  -- Optimistic concurrency token. Bumped by trigger on every update to the job and
  -- on changes to its materials and quotes. A ChangeSet records the version it was
  -- built from and is rejected if the job has moved on.
  version integer not null default 1,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (client_id, org_id) references public.clients (id, org_id) on delete cascade,
  foreign key (site_id, org_id) references public.sites (id, org_id),
  -- The site must belong to the job's client.
  foreign key (site_id, client_id) references public.sites (id, client_id),
  check (scheduled_end is null or scheduled_end > scheduled_start),
  check (status not in ('scheduled', 'in_progress') or scheduled_start is not null)
);
-- Filtering: by status, type, client (and client name via clients_name_trgm_idx), and title.
create index jobs_org_status_idx on public.jobs (org_id, status);
create index jobs_org_job_type_idx on public.jobs (org_id, job_type);
create index jobs_client_id_idx on public.jobs (client_id);
create index jobs_title_trgm_idx on public.jobs using gin (title extensions.gin_trgm_ops);
create index jobs_org_scheduled_start_idx on public.jobs (org_id, scheduled_start) where scheduled_start is not null;

-- Legal transitions. Mirrors JOB_STATUS_TRANSITIONS in packages/shared (checked by a unit test).
create table public.job_status_transitions (
  from_status public.job_status not null,
  to_status public.job_status not null,
  primary key (from_status, to_status)
);
insert into public.job_status_transitions (from_status, to_status) values
  ('lead', 'quoted'),
  ('lead', 'declined'),
  ('lead', 'cancelled'),
  ('quoted', 'accepted'),
  ('quoted', 'declined'),
  ('quoted', 'cancelled'),
  ('accepted', 'scheduled'),
  ('accepted', 'cancelled'),
  ('scheduled', 'in_progress'),
  ('scheduled', 'cancelled'),
  ('in_progress', 'completed'),
  ('in_progress', 'cancelled'),
  ('completed', 'invoiced'),
  ('invoiced', 'paid');

create function public.jobs_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status and not exists (
    select 1 from public.job_status_transitions t
    where t.from_status = old.status and t.to_status = new.status
  ) then
    raise exception 'illegal job status transition: % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;
  -- Callers can't set the version; it always advances by one.
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;
create trigger jobs_before_update before update on public.jobs
  for each row execute function public.jobs_before_update();

create function public.jobs_before_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.version := 1;
  return new;
end;
$$;
create trigger jobs_before_insert before insert on public.jobs
  for each row execute function public.jobs_before_insert();

-- Bumps the parent job's version when a child row changes, so pending ChangeSets
-- built against the old state become stale.
create function public.touch_parent_job() returns trigger
language plpgsql set search_path = '' as $$
declare
  target uuid := case when tg_op = 'DELETE' then old.job_id else new.job_id end;
begin
  if target is not null then
    update public.jobs set updated_at = now() where id = target;
  end if;
  if tg_op = 'UPDATE' and old.job_id is distinct from new.job_id and old.job_id is not null then
    update public.jobs set updated_at = now() where id = old.job_id;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Supply houses and materials
-- ---------------------------------------------------------------------------

create table public.supply_houses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  integration_type public.supply_integration_type not null default 'manual',
  email text,
  phone text,
  account_number text,
  -- Non-secret integration settings only. API credentials belong in Supabase Vault,
  -- read by the worker; every org member can read this table.
  api_config jsonb not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  check (integration_type <> 'email' or email is not null)
);
create index supply_houses_org_id_idx on public.supply_houses (org_id);

-- A material used or needed on a specific job. Not a price-book entry.
create table public.material_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  job_id uuid not null,
  description text not null check (length(trim(description)) > 0),
  quantity numeric(12, 3) not null check (quantity > 0),
  unit text,
  unit_cost_cents bigint check (unit_cost_cents >= 0),
  supply_house_id uuid,
  status public.material_status not null default 'needed',
  removed_at timestamptz,
  removed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (job_id, org_id) references public.jobs (id, org_id) on delete cascade,
  foreign key (supply_house_id, org_id) references public.supply_houses (id, org_id) on delete set null (supply_house_id)
);
create index material_items_job_id_idx on public.material_items (job_id) where removed_at is null;
create trigger material_items_touch_job after insert or update or delete on public.material_items
  for each row execute function public.touch_parent_job();

-- ---------------------------------------------------------------------------
-- Quotes (versioned per job)
-- ---------------------------------------------------------------------------

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  job_id uuid not null,
  version integer not null check (version > 0),
  status public.quote_status not null default 'draft',
  supersedes_quote_id uuid,
  notes text,
  valid_until date,
  total_cents bigint not null default 0 check (total_cents >= 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  unique (job_id, version),
  foreign key (job_id, org_id) references public.jobs (id, org_id) on delete cascade,
  foreign key (supersedes_quote_id, org_id) references public.quotes (id, org_id)
);
create trigger quotes_touch_job after insert or update or delete on public.quotes
  for each row execute function public.touch_parent_job();

create table public.quote_line_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  quote_id uuid not null,
  position integer not null check (position >= 0),
  kind public.quote_line_kind not null,
  description text not null check (length(trim(description)) > 0),
  -- For labor lines quantity is hours and unit is 'hr'.
  quantity numeric(12, 3) not null check (quantity > 0),
  unit text,
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  material_item_id uuid,
  created_at timestamptz not null default now(),
  unique (quote_id, position),
  foreign key (quote_id, org_id) references public.quotes (id, org_id) on delete cascade,
  foreign key (material_item_id, org_id) references public.material_items (id, org_id) on delete set null (material_item_id),
  check (kind = 'material' or material_item_id is null)
);

-- ---------------------------------------------------------------------------
-- Supply orders
-- ---------------------------------------------------------------------------

create table public.supply_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  supply_house_id uuid not null,
  job_id uuid,
  status public.supply_order_status not null default 'draft',
  notes text,
  sent_at timestamptz,
  sent_by uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (supply_house_id, org_id) references public.supply_houses (id, org_id),
  foreign key (job_id, org_id) references public.jobs (id, org_id) on delete set null (job_id),
  check (status <> 'draft' or sent_at is null),
  check (status in ('draft', 'cancelled') or sent_at is not null)
);
create index supply_orders_org_status_idx on public.supply_orders (org_id, status);
create index supply_orders_job_id_idx on public.supply_orders (job_id);

create table public.order_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  supply_order_id uuid not null,
  position integer not null check (position >= 0),
  description text not null check (length(trim(description)) > 0),
  sku text,
  quantity numeric(12, 3) not null check (quantity > 0),
  unit text,
  material_item_id uuid,
  created_at timestamptz not null default now(),
  unique (supply_order_id, position),
  foreign key (supply_order_id, org_id) references public.supply_orders (id, org_id) on delete cascade,
  foreign key (material_item_id, org_id) references public.material_items (id, org_id) on delete set null (material_item_id)
);

-- ---------------------------------------------------------------------------
-- Captures, attachments, notes
-- ---------------------------------------------------------------------------

-- One row per voice note, photo set, or typed entry. All three go through the same pipeline.
create table public.captures (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  created_by uuid not null references auth.users (id),
  type public.capture_type not null,
  -- Typed text, or the transcript / extracted text once the worker has produced it.
  raw_text text,
  target_job_id uuid,
  status public.capture_status not null default 'uploaded',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (target_job_id, org_id) references public.jobs (id, org_id) on delete set null (target_job_id),
  check (type <> 'text' or raw_text is not null)
);
create index captures_org_status_idx on public.captures (org_id, status, created_at desc);

-- Files in Supabase Storage: capture sources (audio, photos), receipts, job photos.
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null,
  byte_size bigint check (byte_size >= 0),
  capture_id uuid,
  job_id uuid,
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (capture_id, org_id) references public.captures (id, org_id) on delete cascade,
  foreign key (job_id, org_id) references public.jobs (id, org_id) on delete set null (job_id)
);
create index attachments_capture_id_idx on public.attachments (capture_id);
create index attachments_job_id_idx on public.attachments (job_id);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  job_id uuid,
  client_id uuid,
  body text not null check (length(trim(body)) > 0),
  author_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (job_id, org_id) references public.jobs (id, org_id) on delete cascade,
  foreign key (client_id, org_id) references public.clients (id, org_id) on delete cascade,
  check (num_nonnulls(job_id, client_id) = 1)
);
create index notes_job_id_idx on public.notes (job_id);
create index notes_client_id_idx on public.notes (client_id);

-- ---------------------------------------------------------------------------
-- Change sets and audit
-- ---------------------------------------------------------------------------

-- An LLM proposal awaiting human review. Nothing in `operations` is applied until approval.
create table public.change_sets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  capture_id uuid not null,
  status public.change_set_status not null default 'pending',
  -- [{ "tool": "...", "args": {...} }], validated against packages/shared tool schemas.
  operations jsonb not null check (jsonb_typeof(operations) = 'array'),
  -- { "<job uuid>": <version> } for every existing job the operations touch.
  base_job_versions jsonb not null default '{}' check (jsonb_typeof(base_job_versions) = 'object'),
  validation_issues jsonb not null default '[]' check (jsonb_typeof(validation_issues) = 'array'),
  -- Temp ID -> real UUID, filled in at commit.
  temp_id_map jsonb,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (capture_id, org_id) references public.captures (id, org_id) on delete cascade,
  check ((status = 'pending') = (reviewed_at is null))
);
create index change_sets_org_pending_idx on public.change_sets (org_id, created_at desc) where status = 'pending';
create index change_sets_capture_id_idx on public.change_sets (capture_id);

-- Append-only record of every committed change.
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid references auth.users (id) on delete set null,
  source public.audit_source not null,
  entity_type text not null,
  entity_id uuid not null,
  action text not null check (action in ('create', 'update', 'delete', 'status_change')),
  before jsonb,
  after jsonb,
  change_set_id uuid,
  capture_id uuid,
  foreign key (change_set_id, org_id) references public.change_sets (id, org_id),
  foreign key (capture_id, org_id) references public.captures (id, org_id),
  -- Changes that came from a capture must say which approved ChangeSet carried them.
  check (source not in ('voice', 'image', 'text') or (change_set_id is not null and capture_id is not null))
);
create index audit_events_entity_idx on public.audit_events (org_id, entity_type, entity_id, occurred_at desc);
create index audit_events_change_set_idx on public.audit_events (change_set_id);

create function public.audit_events_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_events is append-only' using errcode = 'insufficient_privilege';
end;
$$;
create trigger audit_events_no_update before update or delete on public.audit_events
  for each row execute function public.audit_events_immutable();

-- ---------------------------------------------------------------------------
-- Glossary
-- ---------------------------------------------------------------------------

-- Org-level trade shorthand fed to the LLM, e.g. 'SB' -> 'SharkBite push-to-connect fitting'.
create table public.glossary_terms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  term text not null check (length(trim(term)) > 0),
  expansion text not null check (length(trim(expansion)) > 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index glossary_terms_org_term_idx on public.glossary_terms (org_id, lower(term));

-- ---------------------------------------------------------------------------
-- updated_at maintenance (jobs handle their own in jobs_before_update)
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'organizations', 'profiles', 'clients', 'sites', 'equipment', 'supply_houses', 'material_items',
    'quotes', 'supply_orders', 'captures', 'notes', 'glossary_terms'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;
end;
$$;
