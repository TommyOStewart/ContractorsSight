-- Everything the business dashboard shows, in one round trip.
-- SECURITY INVOKER: it runs as the caller, so row-level security limits it to the caller's
-- companies; asking about another company's id simply returns zeros.

create function public.dashboard_summary(p_org_id uuid, p_year integer default null)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with
  params as (
    select coalesce(p_year, extract(year from current_date)::int) as yr
  ),
  months as (
    select generate_series(
      date_trunc('month', current_date) - interval '11 months',
      date_trunc('month', current_date),
      interval '1 month'
    )::date as month
  ),
  paid_by_month as (
    select m.month, coalesce(sum(p.amount_cents), 0)::bigint as cents
    from months m
    left join public.payments p on p.org_id = p_org_id and date_trunc('month', p.paid_on) = m.month
    group by m.month
  ),
  open_invoices as (
    select i.id, i.issued_on, i.total_cents,
           coalesce((select sum(p.amount_cents) from public.payments p where p.invoice_id = i.id), 0) as paid_cents
    from public.invoices i
    where i.org_id = p_org_id and i.status in ('draft', 'sent')
  ),
  latest_quotes as (
    select distinct on (q.job_id) q.job_id, q.total_cents, q.created_at
    from public.quotes q
    where q.org_id = p_org_id
    order by q.job_id, q.version desc
  ),
  job_money as (
    select j.id, coalesce(nullif(j.job_type, ''), 'other') as job_type,
           (select coalesce(sum(p.amount_cents), 0) from public.payments p join public.invoices i on i.id = p.invoice_id
             where i.job_id = j.id and extract(year from p.paid_on) = (select yr from params)) as paid_cents,
           (select coalesce(sum(round(m.quantity * m.unit_cost_cents)), 0) from public.material_items m
             where m.job_id = j.id and m.removed_at is null and m.unit_cost_cents is not null) as material_cents
    from public.jobs j
    where j.org_id = p_org_id
  ),
  year_expenses as (
    select e.*
    from public.expenses e
    where e.org_id = p_org_id and extract(year from e.spent_on) = (select yr from params)
  )
  select jsonb_build_object(
    'year', (select yr from params),
    'paidByMonth', (select jsonb_agg(jsonb_build_object('month', to_char(month, 'YYYY-MM'), 'cents', cents) order by month) from paid_by_month),
    'owed', (
      select jsonb_build_object('cents', coalesce(sum(total_cents - paid_cents), 0), 'invoices', count(*), 'oldestIssuedOn', min(issued_on))
      from open_invoices where total_cents > paid_cents
    ),
    'quotesWaiting', (
      select jsonb_build_object(
        'cents', coalesce(sum(lq.total_cents), 0),
        'count', count(*),
        'olderThan14Days', count(*) filter (where lq.created_at < now() - interval '14 days')
      )
      from public.jobs j join latest_quotes lq on lq.job_id = j.id
      where j.org_id = p_org_id and j.status = 'quoted'
    ),
    'quoteOutcomes90Days', (
      select jsonb_build_object(
        'won', count(*) filter (where j.status in ('accepted', 'scheduled', 'in_progress', 'completed', 'invoiced', 'paid')),
        'lost', count(*) filter (where j.status = 'declined')
      )
      from public.jobs j join latest_quotes lq on lq.job_id = j.id
      where j.org_id = p_org_id and lq.created_at > now() - interval '90 days'
    ),
    'jobsByStatus', coalesce((
      select jsonb_object_agg(status, n) from (select status, count(*) as n from public.jobs where org_id = p_org_id group by status) s
    ), '{}'::jsonb),
    'profitByJobType', coalesce((
      select jsonb_agg(jsonb_build_object(
        'jobType', job_type, 'jobs', jobs, 'paidCents', paid_cents, 'materialCents', material_cents,
        'profitCents', paid_cents - material_cents, 'averagePaidCents', round(paid_cents::numeric / jobs)
      ) order by paid_cents - material_cents desc)
      from (
        select job_type, count(*) as jobs, sum(paid_cents) as paid_cents, sum(material_cents) as material_cents
        from job_money where paid_cents > 0 group by job_type
      ) t
    ), '[]'::jsonb),
    'expensesByCategory', coalesce((
      select jsonb_agg(jsonb_build_object('category', category, 'cents', cents, 'count', n) order by cents desc)
      from (select category, sum(total_cents) as cents, count(*) as n from year_expenses group by category) e
    ), '[]'::jsonb),
    'expensesTotal', (select jsonb_build_object('cents', coalesce(sum(total_cents), 0), 'count', count(*)) from year_expenses),
    'materialsBySupplier', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'cents', cents) order by cents desc)
      from (
        select coalesce(sh.name, nullif(e.vendor_name, ''), 'Other') as name, sum(e.total_cents) as cents
        from year_expenses e left join public.supply_houses sh on sh.id = e.supply_house_id
        where e.category = 'materials'
        group by 1
      ) s
    ), '[]'::jsonb),
    -- No receipt photo: neither attached directly nor captured as a photo.
    'missingReceipts', (
      select count(*) from year_expenses e
      where e.receipt_attachment_id is null
        and not exists (select 1 from public.captures c where c.id = e.capture_id and c.type = 'image')
    )
  );
$$;

revoke execute on function public.dashboard_summary(uuid, integer) from public, anon;
grant execute on function public.dashboard_summary(uuid, integer) to authenticated;
