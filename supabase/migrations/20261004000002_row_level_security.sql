-- Row-level security: a user sees and edits rows only in orgs they belong to.
--
-- The worker uses the service role, which bypasses RLS. That is why the validation layer
-- in packages/shared checks org ownership itself and never trusts IDs from the LLM.

create function public.is_org_member(p_org_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org_id and m.user_id = (select auth.uid())
  );
$$;

create function public.has_org_role(p_org_id uuid, p_roles public.org_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org_id and m.user_id = (select auth.uid()) and m.role = any (p_roles)
  );
$$;

revoke execute on function public.is_org_member(uuid) from public, anon;
revoke execute on function public.has_org_role(uuid, public.org_role[]) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, public.org_role[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Domain tables members can read and write directly (manual edits in the app)
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'clients', 'sites', 'equipment', 'jobs', 'supply_houses', 'material_items', 'quotes',
    'quote_line_items', 'supply_orders', 'order_lines', 'attachments', 'notes', 'glossary_terms'
  ] loop
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

-- ---------------------------------------------------------------------------
-- Organizations and membership
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
create policy organizations_select on public.organizations for select to authenticated
  using ((select public.is_org_member(id)));
create policy organizations_update on public.organizations for update to authenticated
  using ((select public.has_org_role(id, array['owner', 'admin']::public.org_role[])))
  with check ((select public.has_org_role(id, array['owner', 'admin']::public.org_role[])));
-- Creating an org (and its first owner) will go through a security-definer RPC, not a direct insert.

alter table public.org_members enable row level security;
create policy org_members_select on public.org_members for select to authenticated
  using ((select public.is_org_member(org_id)));
create policy org_members_insert on public.org_members for insert to authenticated
  with check ((select public.has_org_role(org_id, array['owner', 'admin']::public.org_role[])));
create policy org_members_update on public.org_members for update to authenticated
  using ((select public.has_org_role(org_id, array['owner', 'admin']::public.org_role[])))
  with check ((select public.has_org_role(org_id, array['owner', 'admin']::public.org_role[])));
create policy org_members_delete on public.org_members for delete to authenticated
  using ((select public.has_org_role(org_id, array['owner', 'admin']::public.org_role[])));

alter table public.profiles enable row level security;
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.org_members mine
      join public.org_members theirs on theirs.org_id = mine.org_id
      where mine.user_id = (select auth.uid()) and theirs.user_id = profiles.id
    )
  );
create policy profiles_insert on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Pipeline tables
-- ---------------------------------------------------------------------------

-- Members create captures; the worker (service role) updates their status.
alter table public.captures enable row level security;
create policy captures_select on public.captures for select to authenticated
  using ((select public.is_org_member(org_id)));
create policy captures_insert on public.captures for insert to authenticated
  with check ((select public.is_org_member(org_id)) and created_by = (select auth.uid()));

-- ChangeSets are written by the worker. Approving one must apply its operations atomically,
-- so members don't update this table directly; that will be a security-definer RPC.
alter table public.change_sets enable row level security;
create policy change_sets_select on public.change_sets for select to authenticated
  using ((select public.is_org_member(org_id)));

-- Members may record their own manual edits. Capture-sourced and system events are
-- written by the commit path (service role). No one may update or delete (see trigger).
alter table public.audit_events enable row level security;
create policy audit_events_select on public.audit_events for select to authenticated
  using ((select public.is_org_member(org_id)));
create policy audit_events_insert_manual on public.audit_events for insert to authenticated
  with check (
    (select public.is_org_member(org_id))
    and source = 'manual'
    and actor_user_id = (select auth.uid())
  );

alter table public.job_status_transitions enable row level security;
create policy job_status_transitions_select on public.job_status_transitions for select to authenticated
  using (true);
