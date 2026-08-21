create or replace function public.atlas_priority_rank(priority_text text)
returns integer
language sql
immutable
as $$
  select case lower(coalesce(priority_text, ''))
    when 'p0' then 0
    when 'p1' then 1
    when 'p2' then 2
    when 'p3' then 3
    else 99
  end
$$;

create or replace function public.atlas_priority_label(priority_rank integer)
returns text
language sql
immutable
as $$
  select case
    when priority_rank <= 0 then 'p0'
    when priority_rank = 1 then 'p1'
    when priority_rank = 2 then 'p2'
    when priority_rank = 3 then 'p3'
    else null
  end
$$;

create or replace function public.atlas_apply_priority_inheritance_self()
returns trigger
language plpgsql
as $$
declare
  self_rank integer;
  inherited_rank integer;
  target_priority text;
begin
  self_rank := public.atlas_priority_rank(new.priority);

  select min(public.atlas_priority_rank(child.priority))
    into inherited_rank
  from public.atlas_actions child
  where child.id <> new.id
    and jsonb_typeof(coalesce(child.blocked_by, '[]'::jsonb)) = 'array'
    and child.blocked_by @> to_jsonb(array[new.id]::text[]);

  if inherited_rank is null then
    return new;
  end if;

  if inherited_rank < self_rank then
    target_priority := public.atlas_priority_label(inherited_rank);
    if target_priority is not null then
      new.priority := target_priority;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.atlas_apply_priority_inheritance_blockers()
returns trigger
language plpgsql
as $$
declare
  blocker_id text;
begin
  if jsonb_typeof(coalesce(new.blocked_by, '[]'::jsonb)) <> 'array' then
    return new;
  end if;

  for blocker_id in
    select jsonb_array_elements_text(coalesce(new.blocked_by, '[]'::jsonb))
  loop
    if blocker_id is null or blocker_id = '' or blocker_id = new.id then
      continue;
    end if;

    update public.atlas_actions blocker
    set priority = new.priority,
        updated_at = timezone('utc'::text, now())
    where blocker.id = blocker_id
      and public.atlas_priority_rank(blocker.priority) > public.atlas_priority_rank(new.priority);
  end loop;

  return new;
end;
$$;

drop trigger if exists atlas_priority_inheritance_self on public.atlas_actions;
create trigger atlas_priority_inheritance_self
before insert or update of priority, blocked_by
on public.atlas_actions
for each row
execute function public.atlas_apply_priority_inheritance_self();

drop trigger if exists atlas_priority_inheritance_blockers on public.atlas_actions;
create trigger atlas_priority_inheritance_blockers
after insert or update of priority, blocked_by
on public.atlas_actions
for each row
execute function public.atlas_apply_priority_inheritance_blockers();
