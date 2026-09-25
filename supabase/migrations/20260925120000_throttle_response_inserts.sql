-- Rate limiting for public.responses, as one atomic insert path.
--
-- This lives in Postgres rather than in netlify/functions/submit.mjs because
-- that function is a Lambda: concurrent invocations are separate processes with
-- separate memory, instances recycle, and cold starts begin empty. A counter
-- held in the function would catch only the requests that happened to reuse one
-- warm instance -- walked past by anything running in parallel, and randomly
-- punitive to a real person who lands on a hot one. Postgres is the only place
-- every submission passes through.
--
-- It is also the only place a limit cannot be bypassed. The Origin check in the
-- function is a low fence by design (see README.md); a script that sets the
-- header itself reaches the insert, and the insert is what this governs.
--
-- Nothing here touches public.responses or its grants, so the currently
-- deployed function -- which still POSTs straight to /rest/v1/responses -- keeps
-- working after this is applied. The switch to the RPC is a separate change.
--
-- Once this has been applied, never edit it -- Supabase tracks migrations by the
-- timestamp in the filename and will skip one it has already seen, so a change
-- here would silently never reach the database. Add a new migration instead.

-- Not in `public`: PostgREST only exposes the public schema, so there is no
-- REST path to the address hashes with any key, secret or otherwise. The revoke
-- is belt-and-braces -- Supabase grants anon and authenticated usage on public,
-- not on schemas created later -- but it states the intent where a future reader
-- will look for it.
create schema if not exists app_private;
revoke all on schema app_private from anon, authenticated;

-- One row per accepted submission. Only the newest window is ever read; older
-- rows are pruned opportunistically by submit_response() below.
create table if not exists app_private.submit_log (
  id         bigint generated always as identity primary key,
  ip_hash    text        not null,
  created_at timestamptz not null default now()
);

-- Both counting queries are "recent rows", one narrowed by address. created_at
-- descending because every read is an upper slice, never a range scan.
create index if not exists submit_log_ip_recent
  on app_private.submit_log (ip_hash, created_at desc);
create index if not exists submit_log_recent
  on app_private.submit_log (created_at desc);

/*
  The write path: check the limits and insert the response in one transaction.

  One statement rather than a check followed by an insert, so there is no window
  between the two -- and so the round trip costs the function nothing extra over
  the direct insert it replaces.

  The caller passes an already-validated row. Every field has been through
  validate() in netlify/functions/submit.mjs, including the allow-lists and the
  spreadsheet-formula neutralisation; this function re-derives nothing and adds
  no validation of its own. The column list below and that function's `row`
  object have to agree -- see the three-place checklist in README.md.
*/
create or replace function public.submit_response(p_ip_hash text, p_row jsonb)
returns void
language plpgsql
security definer
-- security definer needs an explicit search_path, or a caller who can create
-- objects could shadow an unqualified name and have it run as the owner.
-- Everything below is schema-qualified as well.
set search_path = pg_catalog, public, app_private
as $fn$
declare
  -- Deliberately loose. Club members submit from one campus network and from
  -- carrier NAT, so many real people share an address. A rejection reaches the
  -- person as the fatal dialog, which sends them to the backup Google Form --
  -- and that form has no 出演予定M question, so a false positive here does not
  -- merely annoy someone, it costs an answer. Anti-spam only; the global caps
  -- below are what actually protect the project.
  ip_limit   constant int      := 10;
  ip_window  constant interval := interval '10 minutes';

  -- These two can be strict because no real burst approaches them. A club of a
  -- few hundred, all submitting the hour the form is announced, stays far under
  -- 40 in any single minute; a script trips it immediately.
  all_limit  constant int      := 40;
  all_window constant interval := interval '1 minute';

  -- Backstop against a filled free-tier database. Well above any plausible
  -- real count: once it is reached the form turns away genuine submissions too,
  -- so this is the one number to raise rather than lower if in doubt.
  total_cap  constant int      := 2000;
begin
  -- Serialise same-address submissions, so two concurrent requests cannot both
  -- read a count under the limit and both go on to insert. Transaction-scoped:
  -- released on commit or rollback, with nothing to unlock. hashtext() is only
  -- picking a lock number here, so its collisions cost at most a brief wait
  -- between two unrelated addresses.
  --
  -- The global check below is still a read-then-write across addresses, and a
  -- wide enough parallel burst can overshoot all_limit by the number of
  -- requests in flight. That is a rate limit doing its job, not a hole: the
  -- next second's requests are refused.
  perform pg_advisory_xact_lock(hashtext(p_ip_hash));

  if (select count(*) from app_private.submit_log
       where ip_hash = p_ip_hash
         and created_at > now() - ip_window) >= ip_limit then
    raise exception using errcode = 'PT429', message = 'ip rate limit';
  end if;

  if (select count(*) from app_private.submit_log
       where created_at > now() - all_window) >= all_limit then
    raise exception using errcode = 'PT429', message = 'global rate limit';
  end if;

  -- A sequential count, which is the right call at the few thousand rows this
  -- table is capped at and would not be at a million.
  if (select count(*) from public.responses) >= total_cap then
    raise exception using errcode = 'PT429', message = 'response cap reached';
  end if;

  insert into public.responses (
    email, full_name, line_name, tshirt_size, grade,
    performing_in, extra_parts, content_idea
  ) values (
    p_row->>'email',
    p_row->>'full_name',
    p_row->>'line_name',
    p_row->>'tshirt_size',
    p_row->>'grade',
    -- jsonb array -> text[]. The jsonb_typeof guard is what keeps a malformed
    -- value a NULL column rather than a raised "cannot extract elements from a
    -- scalar" -- which would surface as a 502 and the fatal dialog. validate()
    -- means it should never be anything but an array of one to twelve strings.
    -- `with ordinality` and the explicit order by rather than a bare
    -- array_agg: aggregating without one takes whatever order the scan
    -- happens to produce, which is the array's order in practice but is not
    -- promised anywhere. The stored order is the order the page lists the
    -- options in, and that is worth not leaving to chance.
    case when jsonb_typeof(p_row->'performing_in') = 'array' then
      (select array_agg(value order by ord)
         from jsonb_array_elements_text(p_row->'performing_in')
              with ordinality as t(value, ord))
    end,
    p_row->>'extra_parts',
    -- ->> yields SQL NULL for a jsonb null, which is what the function sends
    -- for the one optional question when it is left blank.
    p_row->>'content_idea'
  );

  insert into app_private.submit_log (ip_hash) values (p_ip_hash);

  -- Cheap enough to do inline and it keeps the table from growing without
  -- bound; two days is far past the widest window read above.
  delete from app_private.submit_log
   where created_at < now() - interval '2 days';
end;
$fn$;

-- Same posture as the responses table itself: only the secret key gets in.
-- Revoking from PUBLIC is the load-bearing half -- that is where the default
-- EXECUTE on a new function comes from, and without it a publishable key could
-- call this and insert rows, which would undo the point of the table having no
-- policies.
revoke all on function public.submit_response(text, jsonb)
  from public, anon, authenticated;

-- ...which means service_role now needs saying explicitly, since the revoke
-- above took away the grant it would otherwise have inherited from PUBLIC. The
-- secret key connects as this role, so without this every submission comes back
-- "permission denied for function" -- a 502, and every person sent to the backup
-- form.
--
-- Unguarded on purpose. Wrapping it in a "if the role exists" check would turn a
-- missing service_role into a silently skipped grant, and the first symptom
-- would be a dead form in production. Failing the migration here is the loud,
-- correct outcome -- and the revoke above already assumes these roles exist.
grant execute on function public.submit_response(text, jsonb) to service_role;

-- PostgREST answers from a cached schema; without this the first call can come
-- back as "could not find the function in the schema cache".
notify pgrst, 'reload schema';
