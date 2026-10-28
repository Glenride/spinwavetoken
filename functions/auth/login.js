/**
 * GET /auth/login — spinwave sign-in entry (live 2026-10-28, WorkOS).
 * Builds the WorkOS sign-in address and sends the visitor there.
 * Fresh-login rule: prompt=login forces WorkOS to ask fresh every time
 * instead of carrying over a session from another site.
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

export async function onRequestGet({ env }) {
  const redirectUri = env.WORKOS_REDIRECT_URI || 'https://spinwave.tech/auth/callback';
  if (!env.WORKOS_CLIENT_ID || !env.WORKOS_API_KEY) {
    return new Response('Sign-in is not configured.', { status: 500 });
  }
  const nonce = crypto.randomUUID();
  const sig = await hmacHex(env.WORKOS_API_KEY, nonce);
  const state = `${nonce}.${sig}`;
  const authUrl = new URL('https://api.workos.com/user_management/authorize');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', env.WORKOS_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('provider', 'authkit');
  authUrl.searchParams.set('prompt', 'login');
  authUrl.searchParams.set('state', state);
  const headers = new Headers({ Location: authUrl.toString() });
  headers.append(
    'Set-Cookie',
    `sp_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
  );
  return new Response(null, { status: 302, headers });
}
