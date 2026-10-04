-- Invoices, payments, and business expenses: what the dashboard and the tax view are built on.
-- Enum values mirror packages/shared/src/domain/enums.ts (checked by a unit test).

create type public.invoice_status as enum ('draft', 'sent', 'paid', 'void');
create type public.payment_method as enum ('cash', 'check', 'card', 'transfer', 'other');
create type public.expense_category as enum ('materials', 'tools_equipment', 'vehicle', 'supplies', 'phone_software', 'other');

-- ---------------------------------------------------------------------------
-- Invoices (a job can have several: deposit, progress, final)
-- ---------------------------------------------------------------------------

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  job_id uuid not null,
  -- Human-facing number, sequential per company (#1001, #1002…), assigned by the commit path.
  number integer not null check (number > 0),
  status public.invoice_status not null default 'sent',
  issued_on date not null default current_date,
  due_on date,
  notes text,
  total_cents bigint not null check (total_cents >= 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  unique (org_id, number),
  foreign key (job_id, org_id) references public.jobs (id, org_id) on delete cascade,
  check (due_on is null or due_on >= issued_on)
);
create index invoices_org_status_idx on public.invoices (org_id, status, issued_on desc);
create index invoices_job_id_idx on public.invoices (job_id);

create table public.invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  invoice_id uuid not null,
  position integer not null check (position >= 0),
  kind public.quote_line_kind not null,
  description text not null check (length(trim(description)) > 0),
  -- For labor lines quantity is hours and unit is 'hr'.
  quantity numeric(12, 3) not null check (quantity > 0),
  unit text,
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  created_at timestamptz not null default now(),
  unique (invoice_id, position),
  foreign key (invoice_id, org_id) references public.invoices (id, org_id) on delete cascade
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  invoice_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  paid_on date not null default current_date,
  method public.payment_method,
  -- Check number, last 4 of a card, transfer reference…
  reference text,
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (invoice_id, org_id) references public.invoices (id, org_id) on delete cascade
);
create index payments_invoice_id_idx on public.payments (invoice_id);
create index payments_org_paid_on_idx on public.payments (org_id, paid_on desc);

-- ---------------------------------------------------------------------------
-- Expenses (every business purchase; job materials are expenses too)
-- ---------------------------------------------------------------------------

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  spent_on date not null default current_date,
  category public.expense_category not null,
  total_cents bigint not null check (total_cents >= 0),
  description text,
  -- Where it was bought: a known supply house, or a free-text vendor (gas station, phone company…).
  supply_house_id uuid,
  vendor_name text,
  job_id uuid,
  receipt_attachment_id uuid,
  capture_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (supply_house_id, org_id) references public.supply_houses (id, org_id) on delete set null (supply_house_id),
  foreign key (job_id, org_id) references public.jobs (id, org_id) on delete set null (job_id),
  foreign key (receipt_attachment_id, org_id) references public.attachments (id, org_id) on delete set null (receipt_attachment_id),
  foreign key (capture_id, org_id) references public.captures (id, org_id) on delete set null (capture_id)
);
create index expenses_org_spent_on_idx on public.expenses (org_id, spent_on desc);
create index expenses_org_category_idx on public.expenses (org_id, category, spent_on desc);
create index expenses_job_id_idx on public.expenses (job_id);

-- Parts bought on a receipt point at the expense that paid for them.
alter table public.material_items add column expense_id uuid;
alter table public.material_items
  add constraint material_items_expense_fkey foreign key (expense_id, org_id) references public.expenses (id, org_id) on delete set null (expense_id);

-- Invoices and payments change what a job is worth and owed: bump its version so pending
-- proposals built on the old picture go stale.
create trigger invoices_touch_job after insert or update or delete on public.invoices
  for each row execute function public.touch_parent_job();

do $$
declare
  t text;
begin
  foreach t in array array['invoices', 'expenses'] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;

  foreach t in array array['invoices', 'invoice_line_items', 'payments', 'expenses'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.is_org_member(org_id)))',
      t || '_select', t
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select public.is_org_member(org_id)))',
      t || '_insert', t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select public.is_org_member(org_id))) with check ((select public.is_org_member(org_id)))',
      t || '_update', t
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select public.is_org_member(org_id)))',
      t || '_delete', t
    );
  end loop;
end;
$$;
