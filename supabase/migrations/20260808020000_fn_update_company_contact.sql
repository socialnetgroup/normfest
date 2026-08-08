-- Alan's pilot feedback (2026-08-08): agents want to correct/add Stammdaten
-- during a call ("ovaj broj je pogresan"). `companies` currently has no
-- UPDATE policy at all (VIS import is the only writer, via the service-role
-- client). Deliberately scoped narrow rather than a blanket agent-write
-- policy on `companies`: true VIS master-data fields (name, kundennummer,
-- strasse, plz, ort, land) stay VIS-owned per the existing "enrichment never
-- overwrites imported master data" principle (§3.2.6) - only the contact
-- fields an agent would realistically need to fix live during a call are
-- editable here. Same visibility gate as fn_company_visible (an agent can
-- only edit a company they can already see); `telefon` itself is still
-- VIS-owned data and a later re-import can still overwrite it (same
-- accepted trade-off as the existing Places telefon/website fill, §14 item
-- 11) - telefon_2/telefon_3 are pure agent fields the VIS import never
-- touches, so those never get silently reset.
create or replace function fn_update_company_contact(
  p_company_id uuid,
  p_telefon text default null,
  p_telefon_2 text default null,
  p_telefon_3 text default null,
  p_email text default null,
  p_website text default null
)
returns companies
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row companies;
begin
  if not exists (
    select 1 from companies c
    where c.id = p_company_id and c.soft_deleted_at is null and fn_company_visible(c.gebiet)
  ) then
    raise exception 'company not found or not visible';
  end if;

  update companies set
    telefon = nullif(trim(p_telefon), ''),
    telefon_2 = nullif(trim(p_telefon_2), ''),
    telefon_3 = nullif(trim(p_telefon_3), ''),
    email = nullif(trim(p_email), ''),
    website = nullif(trim(p_website), ''),
    updated_at = now()
  where id = p_company_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function fn_update_company_contact(uuid, text, text, text, text, text) to authenticated;
