-- Private bucket for capture source files (audio, photos) and other attachments.
-- Object paths start with the org ID: '<org_id>/<capture_id>/<file>'.

insert into storage.buckets (id, name, public)
values ('captures', 'captures', false)
on conflict (id) do nothing;

create function public.storage_path_org_member(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.org_members m
    where m.user_id = (select auth.uid())
      and m.org_id::text = (storage.foldername(object_name))[1]
  );
$$;
revoke execute on function public.storage_path_org_member(text) from public, anon;
grant execute on function public.storage_path_org_member(text) to authenticated;

create policy captures_bucket_select on storage.objects for select to authenticated
  using (bucket_id = 'captures' and public.storage_path_org_member(name));
create policy captures_bucket_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'captures' and public.storage_path_org_member(name));
