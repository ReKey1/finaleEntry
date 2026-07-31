-- Defence in depth for public.responses.
--
-- This is a separate migration rather than an edit to 20260801120000 because
-- that one has already run against the project — Supabase tracks migrations by
-- the timestamp in the filename and skips any it has seen, so a change there
-- would never reach the database.
--
-- It was needed because a read of the table with a publishable key returned an
-- empty list rather than "permission denied", which is the signature of the
-- anon role still holding its default SELECT grant. Row level security was
-- correctly denying the request, but RLS was the only thing doing so.
--
-- Supabase grants anon and authenticated privileges on new tables in the public
-- schema by default. Revoking them means that if RLS is ever switched off — from
-- the dashboard, or by a later migration — the responses are still unreadable
-- with a publishable key. The function is unaffected: its secret key connects as
-- a role these grants do not govern.
--
-- Both statements are idempotent and safe to re-run.

alter table public.responses enable row level security;

revoke all on public.responses from anon, authenticated;
