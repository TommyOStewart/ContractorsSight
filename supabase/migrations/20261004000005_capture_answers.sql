-- Answers the contractor gave to the planner's questions (flag_ambiguity) about a capture.
-- Each answer re-plans the capture; keeping them lets later re-plans use every earlier answer
-- and records why a proposal was replaced.

create table public.capture_answers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  capture_id uuid not null,
  -- The proposal that asked the question (replaced by the re-plan).
  change_set_id uuid not null,
  question text not null check (length(trim(question)) > 0),
  answer text not null check (length(trim(answer)) > 0),
  answered_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (capture_id, org_id) references public.captures (id, org_id) on delete cascade,
  foreign key (change_set_id, org_id) references public.change_sets (id, org_id) on delete cascade
);
create index capture_answers_capture_id_idx on public.capture_answers (capture_id, created_at);

-- Written by the worker; members can read them.
alter table public.capture_answers enable row level security;
create policy capture_answers_select on public.capture_answers for select to authenticated
  using ((select public.is_org_member(org_id)));
