/**
 * GET /api/wallet-nonce — SpinWave MVP (2026-10-29).
 * Signed-in only. Issues a single-use, 10-minute nonce + the exact
 * human-readable message the scholar must sign to prove wallet control.
 * The signature itself is verified by /api/wallet-link; this endpoint
 * never trusts a browser-supplied address on its own.
 * No funds move here. Payment is not live yet — see the trust panel.
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

async function sessionEmail(request, env) {
  if (!env.WORKOS_API_KEY) return '';
  let payload = '';
  try {
    payload = b64urlDecode(cookieValue(request.headers.get('Cookie'), 'sp_session'));
  } catch {
    return '';
  }
  const parts = payload.split('.');
  const sig = parts.pop();
  const expiryStr = parts.pop();
  const email = parts.join('.');
  const expiry = Number(expiryStr);
  if (!email || !expiry || expiry * 1000 < Date.now()) return '';
  if (!safeEqual(await hmacHex(env.WORKOS_API_KEY, `${email}.${expiry}`), sig)) return '';
  return email.toLowerCase();
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestGet({ request, env }) {
  const email = await sessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);
  if (!env.SPINWAVE_DB) return json({ error: 'not_configured' }, 500);
  const url = new URL(request.url);
  const address = (url.searchParams.get('address') || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) return json({ error: 'bad_wallet' }, 400);
  const nonce = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + 600;
  const message =
    'Link this wallet to my SpinWave scholar account\n' +
    `Address: ${address}\n` +
    `Nonce: ${nonce}\n` +
    'This signature proves you control this wallet. It does not move funds and does not authorize a payment.';
  const db = env.SPINWAVE_DB;
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS wallet_nonces (email TEXT, address TEXT, nonce TEXT, message TEXT, expires_at INTEGER, used INTEGER DEFAULT 0, created_at INTEGER, PRIMARY KEY(email, nonce))',
    )
    .run();
  await db
    .prepare(
      'INSERT INTO wallet_nonces (email, address, nonce, message, expires_at, used, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
    )
    .bind(email, address, nonce, message, expiresAt, Math.floor(Date.now() / 1000))
    .run();
  return json({ address, nonce, message, expires_at: expiresAt }, 200);
}
