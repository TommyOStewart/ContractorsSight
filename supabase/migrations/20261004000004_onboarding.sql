-- Onboarding: a profile row for every user, and an RPC to create a company with its first owner.

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users who signed up before this migration.
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

-- Organizations have no insert policy: creating one must also make the caller its owner,
-- atomically, or the org would be invisible to everyone (RLS is membership-based).
create function public.create_organization(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'company name is required' using errcode = 'check_violation';
  end if;

  insert into public.organizations (name) values (trim(p_name)) returning id into v_org;
  insert into public.org_members (org_id, user_id, role) values (v_org, v_user, 'owner');
  return v_org;
end;
$$;

revoke execute on function public.create_organization(text) from public, anon;
grant execute on function public.create_organization(text) to authenticated;
