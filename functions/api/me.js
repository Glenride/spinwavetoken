/**
 * GET /api/me — spinwave session check (live 2026-10-28, WorkOS).
 * Verifies the signed session cookie and reports the signed-in email,
 * or 401 when there is no valid session. The page calls this on load
 * to render the signed-in state.
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

function b64urlDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(escape(atob(s + '='.repeat((4 - (s.length % 4)) % 4))));
}

export async function onRequestGet({ request, env }) {
  const fail = () =>
    new Response(JSON.stringify({}), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  if (!env.WORKOS_API_KEY) return fail();
  let payload = '';
  try {
    payload = b64urlDecode(cookieValue(request.headers.get('Cookie'), 'sp_session'));
  } catch {
    return fail();
  }
  // Split from the right: the email itself may contain dots.
  const parts = payload.split('.');
  const sig = parts.pop();
  const expiryStr = parts.pop();
  const email = parts.join('.');
  const expiry = Number(expiryStr);
  if (!email || !expiry || expiry * 1000 < Date.now()) return fail();
  if (!safeEqual(await hmacHex(env.WORKOS_API_KEY, `${email}.${expiry}`), sig)) {
    return fail();
  }
  return new Response(JSON.stringify({ email }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
