-- Bind initiative resources to safe HTTPS links or internal document IDs.

create or replace function public.atlas_validate_initiative_resource_target()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.resource_type = 'link' then
    new.url := nullif(btrim(new.url), '');
    new.document_ref := null;
    if new.url is null
       or char_length(new.url) > 2048
       or new.url !~ '^https://[^[:space:]]+$'
       or new.url ~ '^https://[^/]*@' then
      raise exception using errcode = '22023', message = 'ATLAS_INITIATIVE_RESOURCE_TARGET_INVALID';
    end if;
  elsif new.resource_type = 'document' then
    new.url := null;
    new.document_ref := nullif(btrim(new.document_ref), '');
    if new.document_ref is null
       or new.document_ref !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$' then
      raise exception using errcode = '22023', message = 'ATLAS_INITIATIVE_RESOURCE_TARGET_INVALID';
    end if;
  else
    raise exception using errcode = '22023', message = 'ATLAS_INITIATIVE_RESOURCE_TARGET_INVALID';
  end if;
  return new;
end
$function$;

revoke all on function public.atlas_validate_initiative_resource_target() from public;

drop trigger if exists atlas_initiative_resources_validate_target on public.atlas_initiative_resources;
create trigger atlas_initiative_resources_validate_target
before insert or update of resource_type, url, document_ref
on public.atlas_initiative_resources
for each row execute function public.atlas_validate_initiative_resource_target();

comment on function public.atlas_validate_initiative_resource_target() is
  'Rejects non-HTTPS external links, embedded credentials, and unsafe document references.';
