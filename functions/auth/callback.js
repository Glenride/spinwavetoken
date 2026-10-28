/**
 * GET /auth/callback — spinwave sign-in return (live 2026-10-28, WorkOS).
 * Validates the state, trades the code for the visitor's identity, checks
 * the owner list, and sets the spinwave session cookie. Failures land on
 * the home page with #auth_error=<code> instead of erroring.
 */

const enc = new TextEncoder();

async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function cookieValue(cookieHeader, name) {
  const m = (cookieHeader || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : '';
}

function b64urlEncode(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const clearState =
    'sp_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';
  const fail = (code) => {
    const headers = new Headers({
      Location: `/#auth_error=${encodeURIComponent(code)}`,
    });
    headers.append('Set-Cookie', clearState);
    return new Response(null, { status: 302, headers });
  };
  if (!env.WORKOS_CLIENT_ID || !env.WORKOS_API_KEY) return fail('not_configured');
  if (url.searchParams.get('error')) return fail('workos_rejected');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') || '';
  const cookieState = cookieValue(request.headers.get('Cookie'), 'sp_oauth_state');
  const parts = state.split('.');
  const stateOk =
    !!code &&
    cookieState === state &&
    parts.length === 2 &&
    safeEqual(await hmacHex(env.WORKOS_API_KEY, parts[0]), parts[1]);
  if (!stateOk) return fail('invalid_state');
  let data = null;
  try {
    const res = await fetch('https://api.workos.com/user_management/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: env.WORKOS_CLIENT_ID,
        client_secret: env.WORKOS_API_KEY,
      }),
    });
    if (!res.ok) return fail('workos_rejected');
    data = await res.json().catch(() => null);
  } catch {
    return fail('workos_unreachable');
  }
  const email = ((data && data.user && data.user.email) || '').toLowerCase();
  if (!email) return fail('workos_rejected');
  const owners = (env.WORKOS_OWNER_EMAILS || 'dvaughn@dvaughnhouse.com,dvaughnhouse@gmail.com')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!owners.includes(email)) return fail('not_owner');
  const expiry = Math.floor(Date.now() / 1000) + 2592000;
  const sig = await hmacHex(env.WORKOS_API_KEY, `${email}.${expiry}`);
  const session = b64urlEncode(`${email}.${expiry}.${sig}`);
  const headers = new Headers({ Location: '/' });
  headers.append(
    'Set-Cookie',
    `sp_session=${session}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`,
  );
  headers.append('Set-Cookie', clearState);
  return new Response(null, { status: 302, headers });
}
