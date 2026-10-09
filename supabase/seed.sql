-- Development fixtures only. These are real Clerk team IDs, not parsed repository results.
-- Replace the two IDs when using a different Clerk development instance.
begin;
insert into public.organizations (id) values
  ('org_3KPGVJhPTCOu1EgZ61DmeOGVboj'),
  ('org_3KPM6MD5gJNOrufWtQtF9wNqToi')
on conflict (id) do nothing;

insert into public.projects (id, organization_id, repository_url) values
  ('10000000-0000-4000-8000-000000000001', 'org_3KPGVJhPTCOu1EgZ61DmeOGVboj', 'https://github.com/vercel/next.js'),
  ('10000000-0000-4000-8000-000000000002', 'org_3KPGVJhPTCOu1EgZ61DmeOGVboj', 'https://github.com/facebook/react'),
  ('10000000-0000-4000-8000-000000000003', 'org_3KPM6MD5gJNOrufWtQtF9wNqToi', 'https://github.com/microsoft/TypeScript')
on conflict (id) do nothing;

-- Lifecycle values are explicit fixtures. Commits stay unknown because no repo was fetched.
insert into public.analyses (id, organization_id, project_id, status, is_seed, created_at, started_at, finished_at, failure_message) values
  ('20000000-0000-4000-8000-000000000001', 'org_3KPGVJhPTCOu1EgZ61DmeOGVboj', '10000000-0000-4000-8000-000000000001', 'complete', true, now() - interval '25 hours', now() - interval '25 hours', now() - interval '24 hours', null),
  ('20000000-0000-4000-8000-000000000002', 'org_3KPGVJhPTCOu1EgZ61DmeOGVboj', '10000000-0000-4000-8000-000000000002', 'parsing', true, now() - interval '3 minutes', now() - interval '3 minutes', null, null),
  ('20000000-0000-4000-8000-000000000003', 'org_3KPGVJhPTCOu1EgZ61DmeOGVboj', '10000000-0000-4000-8000-000000000001', 'queued', true, now() - interval '2 minutes', null, null, null),
  ('20000000-0000-4000-8000-000000000004', 'org_3KPGVJhPTCOu1EgZ61DmeOGVboj', '10000000-0000-4000-8000-000000000002', 'failed', true, now() - interval '5 hours', now() - interval '5 hours', now() - interval '5 hours' + interval '1 minute', 'Repository archive download timed out'),
  ('20000000-0000-4000-8000-000000000005', 'org_3KPM6MD5gJNOrufWtQtF9wNqToi', '10000000-0000-4000-8000-000000000003', 'complete', true, now() - interval '3 days', now() - interval '3 days', now() - interval '3 days' + interval '10 minutes', null),
  ('20000000-0000-4000-8000-000000000006', 'org_3KPM6MD5gJNOrufWtQtF9wNqToi', '10000000-0000-4000-8000-000000000003', 'failed', true, now() - interval '1 hour', now() - interval '1 hour', now() - interval '1 hour' + interval '1 minute', 'Repository archive download timed out')
on conflict (id) do update set
  status = excluded.status,
  created_at = excluded.created_at,
  started_at = excluded.started_at,
  finished_at = excluded.finished_at,
  failure_message = excluded.failure_message
where analyses.is_seed
  and analyses.organization_id = excluded.organization_id
  and analyses.project_id = excluded.project_id;
commit;
