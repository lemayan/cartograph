begin;

-- Stop concurrent submissions from attaching a real run to a project during seed cleanup.
lock table public.projects, public.analyses in share row exclusive mode;
with removed_seeds as (
  delete from public.analyses where is_seed returning project_id
)
delete from public.projects p
where p.id in (select project_id from removed_seeds)
  and not exists (select 1 from public.analyses a where a.project_id = p.id and not a.is_seed);

-- The seed marker remains for existing readers, but persisted examples cannot be recreated.
alter table public.analyses add constraint analyses_not_seed_check check (not is_seed);
drop index public.analyses_one_real_run_idx;
alter table public.analyses add constraint analyses_one_per_project unique (project_id);

alter table public.analyses drop constraint analyses_status_check;
update public.analyses set status = 'running' where status = 'parsing';
alter table public.analyses add constraint analyses_status_check
  check (status in ('queued', 'running', 'complete', 'failed'));
alter table public.analyses add constraint analyses_running_stage_check
  check (status <> 'running' or (stage is not null and started_at is not null));

-- All remaining file/edge rows are actual parser data; unknown kinds alone remain nullable.
alter table public.files
  alter column folder set not null, alter column extension set not null,
  alter column lines set not null, alter column hash set not null,
  alter column module set not null, alter column fan_in set not null,
  alter column fan_out set not null, alter column parser_order set not null;
alter table public.edges alter column kinds set not null, alter column parser_order set not null;
create or replace function public.begin_repository_analysis(p_organization_id text, p_repository_url text)
returns table (analysis_id uuid, created boolean, status text)
language plpgsql security invoker set search_path = '' as $$
declare
  project uuid;
  reserved uuid;
begin
  if p_organization_id is null or p_organization_id !~ '^org_[A-Za-z0-9_]+$' then
    raise exception 'A verified Clerk organization is required';
  end if;
  if p_repository_url is null or p_repository_url !~ '^https://github[.]com/[a-z0-9][a-z0-9-]*/[a-z0-9_.-]+$'
    or p_repository_url ~ '/[.]{1,2}$' then raise exception 'Repository URL is not normalized'; end if;
  insert into public.organizations (id) values (p_organization_id) on conflict (id) do nothing;
  -- The upsert locks this project so concurrent submissions reserve one analysis, not two.
  insert into public.projects (organization_id, repository_url) values (p_organization_id, p_repository_url)
    on conflict (organization_id, repository_url) do update set repository_url = excluded.repository_url
    returning id into project;
  insert into public.analyses (organization_id, project_id, status, stage, stage_message, started_at)
    values (p_organization_id, project, 'running', 'fetching', 'Fetching the public repository archive.', clock_timestamp())
    on conflict (project_id) do nothing returning id into reserved;
  return query select a.id, reserved is not null, a.status from public.analyses a
    where a.project_id = project ;
end;
$$;

create or replace function public.advance_repository_analysis(p_organization_id text, p_analysis_id uuid,
  p_stage text, p_message text, p_commit_sha text default null)
returns void language plpgsql security invoker set search_path = '' as $$
declare previous_stage text;
begin
  previous_stage := case p_stage when 'selecting' then 'fetching' when 'parsing' then 'selecting' when 'storing' then 'parsing' end;
  if previous_stage is null then raise exception 'Invalid next stage'; end if;
  if p_stage = 'selecting' and p_commit_sha is null then raise exception 'Fetched archive must have a full commit SHA'; end if;
  update public.analyses set stage = p_stage, stage_message = p_message,
    commit_sha = coalesce(p_commit_sha, commit_sha), updated_at = clock_timestamp()
    where id = p_analysis_id and organization_id = p_organization_id
      and status = 'running' and stage = previous_stage;
  if not found then raise exception 'Analysis is absent, belongs to another organization, or has moved past this stage'; end if;
end;
$$;

create or replace function public.fail_repository_analysis(p_organization_id text, p_analysis_id uuid, p_stage text, p_message text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.analyses set status = 'failed', failure_stage = p_stage, failure_message = p_message,
    stage_message = p_message, finished_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = p_analysis_id and organization_id = p_organization_id  and status = 'running';
  if not found then raise exception 'Analysis cannot be failed in this organization or is already terminal'; end if;
end;
$$;

create or replace function public.store_repository_analysis(p_organization_id text, p_analysis_id uuid, p_result jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  inserted bigint;
  expected_files integer;
  expected_edges integer;
begin
  perform 1 from public.analyses where id = p_analysis_id and organization_id = p_organization_id
     and status = 'running' and stage = 'storing' and commit_sha is not null for update;
  if not found then raise exception 'Analysis is not ready to store in this organization'; end if;
  if p_result is null or p_result->>'schemaVersion' is distinct from '1'
    or jsonb_typeof(p_result->'files') is distinct from 'array'
    or jsonb_typeof(p_result->'edges') is distinct from 'array'
    or jsonb_typeof(p_result->'coverage') is distinct from 'object'
    or nullif(p_result->>'repository', '') is null or nullif(p_result->>'adapter', '') is null then
    raise exception 'Invalid parser result';
  end if;
  expected_files := jsonb_array_length(p_result->'files');
  expected_edges := jsonb_array_length(p_result->'edges');
  if (p_result->'coverage'->>'filesParsed')::integer is distinct from expected_files
    or (p_result->'coverage'->>'filesFound')::integer is distinct from
      expected_files + (p_result->'coverage'->>'filesSkipped')::integer then
    raise exception 'File coverage does not add up';
  end if;
  insert into public.files (organization_id, analysis_id, path, folder, extension, lines, hash, module, kind, fan_in, fan_out, parser_order)
    select p_organization_id, p_analysis_id, f.path, f.folder, f.extension, f.lines, f.hash, f.module, f.kind, f."fanIn", f."fanOut", element.position::integer
    from jsonb_array_elements(p_result->'files') with ordinality as element(value, position)
    cross join lateral jsonb_to_record(element.value) as f(path text, folder text, extension text, lines integer,
      hash text, module text, kind text, "fanIn" integer, "fanOut" integer);
  get diagnostics inserted = row_count;
  if inserted <> expected_files then raise exception 'File storage is incomplete'; end if;
  insert into public.edges (organization_id, analysis_id, source_file_id, target_file_id, kinds, parser_order)
    select p_organization_id, p_analysis_id, source.id, target.id, e.kinds, element.position::integer
    from jsonb_array_elements(p_result->'edges') with ordinality as element(value, position)
    cross join lateral jsonb_to_record(element.value) as e(source text, target text, kinds text[])
    join public.files source on source.analysis_id = p_analysis_id and source.organization_id = p_organization_id and source.path = e.source
    join public.files target on target.analysis_id = p_analysis_id and target.organization_id = p_organization_id and target.path = e.target;
  get diagnostics inserted = row_count;
  if inserted <> expected_edges then raise exception 'An edge has an absent endpoint'; end if;
  update public.analyses set parser_schema_version = 1, repository_name = p_result->>'repository', adapter = p_result->>'adapter',
    coverage = p_result->'coverage', status = 'complete', stage_message = 'Analysis stored.',
    finished_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = p_analysis_id and organization_id = p_organization_id;
end;
$$;

commit;
