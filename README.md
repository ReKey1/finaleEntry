# 23引退公演finaleエントリーフォーム

A rebuild of a Google Form as a static page, with responses saved to Supabase.

```
public/index.html            the form - no credentials, safe to publish
netlify/functions/submit.mjs the only code that talks to Supabase
netlify.toml                 publish dir, /api/submit route, security headers
.env.example                 the environment variables you need to set
supabase/migrations/         the schema, as SQL files applied in filename order
.github/workflows/           applies those migrations on push to main
test.original.html           the saved Google Form this page is copied from
```

## Questions and columns

`test.original.html` is the saved original. Everything below was read out of the
`FB_PUBLIC_LOAD_DATA_` blob in that file, and `public/index.html` reproduces it
question for question.

| Question | Type | Required | Column |
|---|---|---|---|
| *(none - the original uses your Google account)* | short answer | yes | `email` |
| おなまえ【フルネーム】 | short answer | yes | `full_name` |
| Line名 | short answer | yes | `line_name` |
| finaleTシャツのサイズ | dropdown, S/M/L/XL/XXL | yes | `tshirt_size` |*
| W+I&S での学年 | radio, 22/23/24/25/26 | yes | `grade` |
| finaleでパートを増やしたくない | radio, かまわない！/はい | yes | `extra_parts` |
| finaleコマでやりたいコンテンツ | short answer | no | `content_idea` |

The Email question is the one addition. Google Forms fills that in from the
signed-in account, which only works inside Forms, so the rebuild asks for it as
an ordinary required text field and validates it on both sides.

\* finaleTシャツのサイズ is a dropdown on the original. The rebuild renders it as
a radio list instead — a native `<select>` cannot be styled to match Forms
without replacing it wholesale, and the answer set is short enough to show in
full. The stored values are unchanged.

The form also opens with a YouTube item (M9 フィナーレ, `QhTF_ZH1AMY`). It has no
answer and no column.

## How secrets are handled

The browser never receives a Supabase key. `public/index.html` POSTs answers to
`/api/submit`; the function reads `SUPABASE_SERVICE_ROLE_KEY` from the
environment and performs the insert itself.

This is why there is no build step. A bundler could inject an anon key at build
time and keep it out of Git, but it would still be readable in the deployed
page — every key the browser holds is public. Moving the call server-side is
what actually keeps it secret.

## Database setup

The schema lives in `supabase/migrations/`, not in the dashboard.
`.github/workflows/migrations.yml` runs `supabase db push` on every push to
`main`, applying any migration the database has not run yet.

Supabase's own GitHub integration does the same job from the dashboard, but it
is built on Branching, which needs a paid plan — hence the Action.

It reads three repository secrets, set under **Settings → Secrets and variables
→ Actions**:

| Secret | Where to find it |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Account settings → Access Tokens → Generate new token |
| `SUPABASE_DB_PASSWORD` | the database password chosen when the project was created |
| `SUPABASE_PROJECT_ID` | the project ref — the subdomain in your project URL |

To apply migrations by hand instead:

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

The CLI does not support `npm i -g supabase`; use `npx`, or `scoop install
supabase` on Windows.

> The first migration **drops** `public.responses` before creating it, to clear
> out the placeholder table an earlier version of this project used. Export
> anything you want to keep before applying it.

If you already built the table by pasting SQL into the editor, tell Supabase
that migration is accounted for so it is not run again:

```bash
npx supabase migration repair --status applied 20260801120000
```

Leave the table with **no policies**. RLS then denies every anonymous request,
and the service_role key used by the function bypasses RLS. There is no public
write path to the database.

If you followed an earlier setup that added an anon insert policy, remove it:

```sql
drop policy if exists "anon can insert responses" on public.responses;
```

### Changing the schema later

Never edit a migration that has already run — Supabase tracks them by the
timestamp in the filename and will skip a file it has seen. Add a new one:

```bash
npx supabase migration new add_some_column
```

Write the `alter table` into the file it creates, then push.

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

A question lives in three places, and all three have to agree:

1. **`public/index.html`** — the card markup, plus one entry in the `FIELDS`
   array in the script. `key` is the column name; `required` drives both the
   asterisk and the validation.
2. **`netlify/functions/submit.mjs`** — a line in the `row` object and a check
   in `validate()`. Closed lists have their own set: `ALLOWED_SIZES`,
   `ALLOWED_GRADES`, `ALLOWED_PARTS`. Rename an option in the page and you must
   rename it in the matching set, or the function will reject it.
3. **`public.responses`** — a column with the same name as `key`. The function
   sends the row as-is, so an unknown key makes Supabase reject the insert.
