-- 出演予定M — the first multi-answer question on the form, and so the first
-- array column. Kept in step with the `performing_in` key in the FIELDS array
-- in public/index.html and with MS_OPTIONS in netlify/functions/submit.mjs.
--
-- Once this has been applied, never edit it — Supabase tracks migrations by the
-- timestamp in the filename and will skip one it has already seen, so a change
-- here would silently never reach the database. Add a new migration instead.

-- Nullable, unlike the other required questions: rows written before this ran
-- have no answer to give, and a `not null` column with no default would fail
-- the push outright. Required-ness for new rows is enforced by the function.
alter table public.responses
  add column if not exists performing_in text[];

comment on column public.responses.performing_in is
  '出演予定M — multi-select. Null on rows created before 2026-08-01.';

-- cardinality, not array_length: array_length('{}', 1) is NULL, and a check
-- constraint passes on NULL, so an empty array would slip straight through.
-- cardinality('{}') is 0. The upper bound pins the option count in the schema,
-- so a thirteenth option cannot be added to the page without a migration — and
-- therefore without going through the three-layer checklist in README.md.
alter table public.responses
  drop constraint if exists responses_performing_in_not_empty;
alter table public.responses
  add constraint responses_performing_in_not_empty
  check (performing_in is null or cardinality(performing_in) between 1 and 12);

-- PostgREST answers from a cached copy of the column list. Supabase reloads it
-- on DDL by itself, but doing it here closes the window where an insert would
-- come back as PGRST204 "could not find the column in the schema cache".
notify pgrst, 'reload schema';
