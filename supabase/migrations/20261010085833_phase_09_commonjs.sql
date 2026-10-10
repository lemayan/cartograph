begin;

-- Keep seed and saved pre-CommonJS rows nullable; real new parses supply explicit arrays.
alter table public.files add column commonjs_exports text[] check (
  array_position(commonjs_exports, null) is null and array_position(commonjs_exports, '') is null
);
alter table public.edges drop constraint edges_kinds_check;
alter table public.edges add constraint edges_kinds_check check (
  cardinality(kinds) between 1 and 4 and kinds <@ array['import', 're-export', 'dynamic-import', 'require']::text[]
);

-- Store routes in the same transaction as files/edges; their composite FK preserves tenant binding.
create or replace function public.store_repository_analysis(p_organization_id text, p_analysis_id uuid, p_run_id uuid, p_result jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  inserted bigint;
  expected_files integer;
  expected_edges integer;
  expected_routes integer;
begin
  perform 1 from public.analyses where id = p_analysis_id and organization_id = p_organization_id
     and run_id = p_run_id and status = 'running' and stage = 'storing' and commit_sha is not null for update;
  if not found then raise exception 'Analysis is not ready to store in this organization'; end if;
  if p_result is null or p_result->>'schemaVersion' is distinct from '1'
    or jsonb_typeof(p_result->'files') is distinct from 'array'
    or jsonb_typeof(p_result->'edges') is distinct from 'array'
    or jsonb_typeof(p_result->'coverage') is distinct from 'object'
    or nullif(p_result->>'repository', '') is null or nullif(p_result->>'adapter', '') is null then
    raise exception 'Invalid parser result';
  end if;
  if p_result ? 'routes' and jsonb_typeof(p_result->'routes') is distinct from 'array' then raise exception 'Invalid routes list'; end if;
  expected_routes := jsonb_array_length(coalesce(p_result->'routes', '[]'::jsonb));
  expected_files := jsonb_array_length(p_result->'files');
  expected_edges := jsonb_array_length(p_result->'edges');
  if (p_result->'coverage'->>'filesParsed')::integer is distinct from expected_files
    or (p_result->'coverage'->>'filesFound')::integer is distinct from
      expected_files + (p_result->'coverage'->>'filesSkipped')::integer then
    raise exception 'File coverage does not add up';
  end if;
  -- Missing metadata is legacy data, not an empty extraction. Reject invalid names before any inserts.
  if exists (select 1 from jsonb_array_elements(p_result->'files') f
    where f ? 'commonjsExports' and jsonb_typeof(f->'commonjsExports') is distinct from 'array') then
    raise exception 'Invalid CommonJS exports list';
  end if;
  if exists (select 1 from jsonb_array_elements(p_result->'files') f
    cross join lateral jsonb_array_elements(coalesce(f->'commonjsExports', '[]'::jsonb)) n
    where jsonb_typeof(n) <> 'string' or n #>> '{}' = '' or n #>> '{}' ~ '[[:cntrl:]]')
    or exists (select 1 from jsonb_array_elements(p_result->'files') f
      where jsonb_array_length(coalesce(f->'commonjsExports', '[]'::jsonb)) <>
        (select count(distinct n) from jsonb_array_elements(coalesce(f->'commonjsExports', '[]'::jsonb)) n)) then
    raise exception 'Invalid CommonJS export names';
  end if;
  insert into public.files (organization_id, analysis_id, path, folder, extension, lines, hash, module, kind, fan_in, fan_out, parser_order, commonjs_exports)
    select p_organization_id, p_analysis_id, f.path, f.folder, f.extension, f.lines, f.hash, f.module, f.kind, f."fanIn", f."fanOut", element.position::integer, f."commonjsExports"
    from jsonb_array_elements(p_result->'files') with ordinality as element(value, position)
    cross join lateral jsonb_to_record(element.value) as f(path text, folder text, extension text, lines integer,
      hash text, module text, kind text, "fanIn" integer, "fanOut" integer, "commonjsExports" text[]);
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
  insert into public.routes (organization_id, analysis_id, file_id, method, path, line, parser_order)
    select p_organization_id, p_analysis_id, f.id, r.method, r.path, r.line, element.position::integer
    from jsonb_array_elements(coalesce(p_result->'routes', '[]'::jsonb)) with ordinality element(value, position)
    cross join lateral jsonb_to_record(element.value) r(file text, method text, path text, line integer)
    join public.files f on f.analysis_id = p_analysis_id and f.organization_id = p_organization_id and f.path = r.file
    where r.method in ('GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS','ALL')
      and r.path like '/%' and r.path !~ '[?#[:cntrl:]]' and r.line between 1 and f.lines;
  get diagnostics inserted = row_count;
  if inserted <> expected_routes then raise exception 'A route is invalid or references an absent file'; end if;
  update public.analyses set routes_extracted = p_result ? 'routes', parser_schema_version = 1, repository_name = p_result->>'repository', adapter = p_result->>'adapter',
    coverage = p_result->'coverage', status = 'complete', stage_message = 'Analysis stored.',
    finished_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = p_analysis_id and organization_id = p_organization_id and run_id = p_run_id;
end;
$$;

-- Preserve the pre-adapter JSON shape for old saved analyses. An empty array is new extraction, not guessed old data.
create or replace function public.read_repository_analysis(p_analysis_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('schemaVersion', a.parser_schema_version, 'repository', a.repository_name, 'adapter', a.adapter,
    'coverage', a.coverage, 'files', coalesce((
      select jsonb_agg(jsonb_build_object('path', f.path, 'folder', f.folder, 'extension', f.extension, 'lines', f.lines,
        'hash', f.hash, 'module', f.module, 'kind', f.kind, 'fanIn', f.fan_in, 'fanOut', f.fan_out) || case when f.commonjs_exports is null then '{}'::jsonb
          else jsonb_build_object('commonjsExports', f.commonjs_exports) end order by f.parser_order)
      from public.files f where f.analysis_id = a.id
    ), '[]'::jsonb), 'edges', coalesce((
      select jsonb_agg(jsonb_build_object('source', source.path, 'target', target.path, 'kinds', e.kinds) order by e.parser_order)
      from public.edges e join public.files source on source.id = e.source_file_id
        join public.files target on target.id = e.target_file_id where e.analysis_id = a.id
    ), '[]'::jsonb)) || case when a.routes_extracted then jsonb_build_object('routes', coalesce((
      select jsonb_agg(jsonb_build_object('file', f.path, 'method', r.method, 'path', r.path, 'line', r.line) order by r.parser_order)
      from public.routes r join public.files f on f.id = r.file_id where r.analysis_id = a.id
    ), '[]'::jsonb)) else '{}'::jsonb end
  from public.analyses a where a.id = p_analysis_id and a.status = 'complete' and a.parser_schema_version = 1;
$$;


commit;
