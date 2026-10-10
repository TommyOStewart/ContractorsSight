-- Quotes and invoices can be sent to the customer as a link to a page served by the worker.
-- The token in the link is the only credential: long, random, and unique. Members can read it
-- (to send the link again); only the worker creates tokens and records approvals.

-- Changes made by the customer on that page (approving a quote). Mirrors AUDIT_SOURCES in packages/shared.
alter type public.audit_source add value 'customer';

alter table public.quotes
  add column share_token text unique check (length(share_token) >= 32),
  add column sent_at timestamptz,
  add column accepted_at timestamptz,
  -- The name the customer typed when approving online.
  add column accepted_by_name text check (length(trim(accepted_by_name)) > 0);

alter table public.invoices
  add column share_token text unique check (length(share_token) >= 32),
  add column sent_at timestamptz;
