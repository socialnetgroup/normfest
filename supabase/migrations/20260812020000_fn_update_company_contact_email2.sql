-- Adds p_email_2 to fn_update_company_contact (20260808020000) alongside the
-- new companies.email_2 column - a changed parameter list needs an explicit
-- drop first (create or replace does NOT replace a function whose signature
-- changed - same overload trap already documented in the Wiedervorlage fix,
-- 20260806030000_fix_wiedervorlage_function_overload.sql).
drop function if exists fn_update_company_contact(uuid, text, text, text, text, text);

create or replace function fn_update_company_contact(
  p_company_id uuid,
  p_telefon text default null,
  p_telefon_2 text default null,
  p_telefon_3 text default null,
  p_email text default null,
  p_email_2 text default null,
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
    email_2 = nullif(trim(p_email_2), ''),
    website = nullif(trim(p_website), ''),
    updated_at = now()
  where id = p_company_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function fn_update_company_contact(uuid, text, text, text, text, text, text) to authenticated;
