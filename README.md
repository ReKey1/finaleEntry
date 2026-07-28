# Scores

A rebuild of a Google Form as a static page, with responses saved to Supabase.

```
public/index.html            the form - no credentials, safe to publish
netlify/functions/submit.mjs the only code that talks to Supabase
netlify.toml                 publish dir, /api/submit route, security headers
.env.example                 the environment variables you need to set
```

## How secrets are handled

The browser never receives a Supabase key. `public/index.html` POSTs answers to
`/api/submit`; the function reads `SUPABASE_SERVICE_ROLE_KEY` from the
environment and performs the insert itself.

This is why there is no build step. A bundler could inject an anon key at build
time and keep it out of Git, but it would still be readable in the deployed
page — every key the browser holds is public. Moving the call server-side is
what actually keeps it secret.

## Database setup

Run once in the Supabase SQL editor:

```sql
create table public.responses (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  email      text,
  name       text not null,
  choice     text
);

alter table public.responses enable row level security;
```

Leave the table with **no policies**. RLS then denies every anonymous request,
and the service_role key used by the function bypasses RLS. There is no public
write path to the database.

If you followed an earlier setup that added an anon insert policy, remove it:

```sql
drop policy if exists "anon can insert responses" on public.responses;
```

## Local development

```bash
npm i -g netlify-cli
cp .env.example .env      # then fill in both values
netlify dev
```

Open the address it prints. Opening `public/index.html` from the filesystem
will not work — there is no function to answer `/api/submit`.

## Deploying

```bash
netlify deploy --prod
```

Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` under **Site configuration →
Environment variables** first, otherwise submissions return
"The server is not configured yet."

## Changing the form

Options live in `public/index.html`. When you add or rename one, update
`ALLOWED_CHOICES` in `netlify/functions/submit.mjs` — the function rejects
values it does not recognise. New questions need a matching column on
`public.responses` and a line in the `row` object the function builds.
