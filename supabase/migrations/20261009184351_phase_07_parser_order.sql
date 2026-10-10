-- Arrays are part of the parser contract. Path sorting cannot reproduce a directory walk's order.
alter table public.files add column parser_order integer check (parser_order > 0);
alter table public.edges add column parser_order integer check (parser_order > 0);
alter table public.files add constraint files_parser_order_metadata_check check (
  (module is null and parser_order is null) or (module is not null and parser_order is not null)
);
alter table public.edges add constraint edges_parser_order_metadata_check check (
  (kinds is null and parser_order is null) or (kinds is not null and parser_order is not null)
);
create unique index files_parser_order_idx on public.files (analysis_id, parser_order) where parser_order is not null;
create unique index edges_parser_order_idx on public.edges (analysis_id, parser_order) where parser_order is not null;

create or replace function public.store_repository_analysis(p_organization_id text, p_analysis_id uuid, p_result jsonb)
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

create or replace function public.read_repository_analysis(p_analysis_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('schemaVersion', a.parser_schema_version, 'repository', a.repository_name, 'adapter', a.adapter,
    'coverage', a.coverage, 'files', coalesce((
      select jsonb_agg(jsonb_build_object('path', f.path, 'folder', f.folder, 'extension', f.extension, 'lines', f.lines,
        'hash', f.hash, 'module', f.module, 'kind', f.kind, 'fanIn', f.fan_in, 'fanOut', f.fan_out) order by f.parser_order)
      from public.files f where f.analysis_id = a.id
    ), '[]'::jsonb), 'edges', coalesce((
      select jsonb_agg(jsonb_build_object('source', source.path, 'target', target.path, 'kinds', e.kinds) order by e.parser_order)
      from public.edges e join public.files source on source.id = e.source_file_id
        join public.files target on target.id = e.target_file_id where e.analysis_id = a.id
    ), '[]'::jsonb))
  from public.analyses a where a.id = p_analysis_id and a.status = 'complete' and a.parser_schema_version = 1;
$$;
