-- How the company appears at the top of the quotes and invoices it sends: contact details a
-- customer can reach it by, and the license number many states require on a written estimate.
-- All optional; owners and admins edit them (organizations_update policy).

alter table public.organizations
  add column phone text check (length(trim(phone)) > 0),
  add column email text check (length(trim(email)) > 0),
  -- Free-form, one line per row as it should print ("37 Nancy Ave\nEast Falmouth, MA 02536").
  add column address text check (length(trim(address)) > 0),
  add column license_number text check (length(trim(license_number)) > 0);
