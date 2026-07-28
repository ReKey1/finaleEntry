/**
 * POST /api/submit
 *
 * The only place in this project that holds Supabase credentials. They are
 * read from environment variables at runtime and never sent to the browser,
 * so nothing secret ends up in the deployed page or in Git.
 *
 * Required environment variables:
 *   SUPABASE_URL                 https://<project-ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY    Settings -> API -> service_role (secret)
 *
 * The service_role key bypasses row level security, which is why the
 * database needs no public insert policy at all - see README.md.
 */

const TABLE = 'responses';

// Keep in step with the options offered in public/index.html.
const ALLOWED_CHOICES = new Set(['Option 1']);

const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 320;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Returns an error string, or null when the payload is acceptable. */
function validate({ name, email, choice }) {
  if (!name) return 'Name is required.';
  if (name.length > MAX_NAME_LENGTH) return 'That name is too long.';

  if (email !== null) {
    if (email.length > MAX_EMAIL_LENGTH) return 'That email address is too long.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'That email address looks wrong.';
  }

  if (choice !== null && !ALLOWED_CHOICES.has(choice)) {
    return 'Unrecognised option.';
  }

  return null;
}

export default async (req) => {
  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed.' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    return json(500, { error: 'The server is not configured yet.' });
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: 'Expected a JSON body.' });
  }

  // Never trust the client: re-derive every field rather than forwarding
  // the request body, so extra keys cannot reach the table.
  const row = {
    name: typeof payload.name === 'string' ? payload.name.trim() : '',
    email: typeof payload.email === 'string' && payload.email.trim()
      ? payload.email.trim()
      : null,
    choice: typeof payload.choice === 'string' ? payload.choice : null,
  };

  const problem = validate(row);
  if (problem) {
    return json(400, { error: problem });
  }

  const res = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/rest/v1/${TABLE}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      prefer: 'return=minimal',
    },
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    // Log the detail, return something generic - Supabase errors quote
    // column names and constraints we would rather not publish.
    console.error('Supabase insert failed:', res.status, await res.text());
    return json(502, { error: 'Could not save your response. Please try again.' });
  }

  return json(201, { ok: true });
};
