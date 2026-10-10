-- Seed rows remain labelled fixtures. Only real analyses participate in repository deduplication.
create unique index analyses_one_real_run_idx on public.analyses (project_id) where not is_seed;

alter table public.analyses
  add column stage text check (stage in ('fetching', 'selecting', 'parsing', 'storing')),
  add column stage_message text check (stage_message is null or btrim(stage_message) <> ''),
  add column failure_stage text check (failure_stage in ('fetching', 'selecting', 'parsing', 'storing')),
  add column updated_at timestamptz not null default now(),
  add column parser_schema_version integer check (parser_schema_version = 1),
  add column repository_name text check (repository_name is null or btrim(repository_name) <> ''),
  add column adapter text check (adapter is null or btrim(adapter) <> ''),
  add column coverage jsonb check (coverage is null or jsonb_typeof(coverage) = 'object');

alter table public.files
  add column folder text,
  add column extension text,
  add column lines integer check (lines >= 0),
  add column hash text check (hash ~ '^[0-9a-f]{64}$'),
  add column module text check (module in ('module', 'script')),
  add column kind text,
  add column fan_in integer check (fan_in >= 0),
  add column fan_out integer check (fan_out >= 0),
  add constraint files_parser_metadata_check check (
    (folder is null and extension is null and lines is null and hash is null and module is null and fan_in is null and fan_out is null)
    or (folder is not null and extension is not null and lines is not null and hash is not null and module is not null and fan_in is not null and fan_out is not null)
  );
alter table public.edges add column kinds text[] check (
  cardinality(kinds) between 1 and 3 and kinds <@ array['import', 're-export', 'dynamic-import']::text[]
);

-- No authenticated write grant or policy is added. The only writer holds the server secret key.
grant select, insert, update on public.organizations, public.projects, public.analyses to service_role;
grant select, insert on public.files, public.edges to service_role;

create function public.begin_repository_analysis(p_organization_id text, p_repository_url text)
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
    values (p_organization_id, project, 'parsing', 'fetching', 'Fetching the public repository archive.', clock_timestamp())
    on conflict (project_id) where not is_seed do nothing returning id into reserved;
  return query select a.id, reserved is not null, a.status from public.analyses a
    where a.project_id = project and not a.is_seed;
end;
$$;

create function public.advance_repository_analysis(p_organization_id text, p_analysis_id uuid,
  p_stage text, p_message text, p_commit_sha text default null)
returns void language plpgsql security invoker set search_path = '' as $$
declare previous_stage text;
begin
  previous_stage := case p_stage when 'selecting' then 'fetching' when 'parsing' then 'selecting' when 'storing' then 'parsing' end;
  if previous_stage is null then raise exception 'Invalid next stage'; end if;
  if p_stage = 'selecting' and p_commit_sha is null then raise exception 'Fetched archive must have a full commit SHA'; end if;
  update public.analyses set stage = p_stage, stage_message = p_message,
    commit_sha = coalesce(p_commit_sha, commit_sha), updated_at = clock_timestamp()
    where id = p_analysis_id and organization_id = p_organization_id and not is_seed
      and status = 'parsing' and stage = previous_stage;
  if not found then raise exception 'Analysis is absent, belongs to another organization, or has moved past this stage'; end if;
end;
$$;

create function public.store_repository_analysis(p_organization_id text, p_analysis_id uuid, p_result jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  inserted bigint;
  expected_files integer;
  expected_edges integer;
begin
  perform 1 from public.analyses where id = p_analysis_id and organization_id = p_organization_id
    and not is_seed and status = 'parsing' and stage = 'storing' and commit_sha is not null for update;
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
  insert into public.files (organization_id, analysis_id, path, folder, extension, lines, hash, module, kind, fan_in, fan_out)
    select p_organization_id, p_analysis_id, f.path, f.folder, f.extension, f.lines, f.hash, f.module, f.kind, f."fanIn", f."fanOut"
    from jsonb_to_recordset(p_result->'files') as f(path text, folder text, extension text, lines integer,
      hash text, module text, kind text, "fanIn" integer, "fanOut" integer);
  get diagnostics inserted = row_count;
  if inserted <> expected_files then raise exception 'File storage is incomplete'; end if;
  insert into public.edges (organization_id, analysis_id, source_file_id, target_file_id, kinds)
    select p_organization_id, p_analysis_id, source.id, target.id, e.kinds
    from jsonb_to_recordset(p_result->'edges') as e(source text, target text, kinds text[])
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

create function public.fail_repository_analysis(p_organization_id text, p_analysis_id uuid, p_stage text, p_message text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.analyses set status = 'failed', failure_stage = p_stage, failure_message = p_message,
    stage_message = p_message, finished_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = p_analysis_id and organization_id = p_organization_id and not is_seed and status = 'parsing';
  if not found then raise exception 'Analysis cannot be failed in this organization or is already terminal'; end if;
end;
$$;

-- One result read rather than polling or an unbounded sequence of table queries. RLS still owns every row read.
create function public.read_repository_analysis(p_analysis_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('schemaVersion', a.parser_schema_version, 'repository', a.repository_name, 'adapter', a.adapter,
    'coverage', a.coverage, 'files', coalesce((
      select jsonb_agg(jsonb_build_object('path', f.path, 'folder', f.folder, 'extension', f.extension, 'lines', f.lines,
        'hash', f.hash, 'module', f.module, 'kind', f.kind, 'fanIn', f.fan_in, 'fanOut', f.fan_out) order by f.path)
      from public.files f where f.analysis_id = a.id
    ), '[]'::jsonb), 'edges', coalesce((
      select jsonb_agg(jsonb_build_object('source', source.path, 'target', target.path, 'kinds', e.kinds) order by source.path, target.path)
      from public.edges e join public.files source on source.id = e.source_file_id
        join public.files target on target.id = e.target_file_id where e.analysis_id = a.id
    ), '[]'::jsonb))
  from public.analyses a where a.id = p_analysis_id and a.status = 'complete' and a.parser_schema_version = 1;
$$;

revoke all on function public.begin_repository_analysis(text, text) from public, anon, authenticated;
revoke all on function public.advance_repository_analysis(text, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.store_repository_analysis(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fail_repository_analysis(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.begin_repository_analysis(text, text),
  public.advance_repository_analysis(text, uuid, text, text, text), public.store_repository_analysis(text, uuid, jsonb),
  public.fail_repository_analysis(text, uuid, text, text) to service_role;
revoke all on function public.read_repository_analysis(uuid) from public, anon, authenticated;
grant execute on function public.read_repository_analysis(uuid) to authenticated, service_role;
