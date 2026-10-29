/**
 * /api/wallet-link — SpinWave MVP (2026-10-29).
 * GET  → the caller's current verified wallet link, or { verified: false }.
 * POST → { address, signature } — verifies the signature server-side
 *   against the single-use nonce issued by /api/wallet-nonce, using
 *   pure-JS Keccak-256 + secp256k1 recovery (tested 2026-10-29 against
 *   Foundry-signed vectors for two test keys; a tampered message
 *   recovers a different address and is rejected).
 * A link recorded here is the ONLY wallet link the payment rail may
 * ever use. The old waitlist wallet field is unverified and is never
 * used for payment. No funds move here — payment is not live yet.
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

// Pure-JS Keccak-256 + secp256k1 recovery (BigInt). No dependencies.
const MASK64 = (1n << 64n) - 1n;
function rotl64(x, n){ n = BigInt(n % 64); if(n===0n) return x & MASK64; return ((x << n) | (x >> (64n - n))) & MASK64; }
const RC = [0x0000000000000001n,0x0000000000008082n,0x800000000000808an,0x8000000080008000n,0x000000000000808bn,0x0000000080000001n,0x8000000080008081n,0x8000000000008009n,0x000000000000008an,0x0000000000000088n,0x0000000080008009n,0x000000008000000an,0x000000008000808bn,0x800000000000008bn,0x8000000000008089n,0x8000000000008003n,0x8000000000008002n,0x8000000000000080n,0x000000000000800an,0x800000008000000an,0x8000000080008081n,0x8000000000008080n,0x0000000080000001n,0x8000000080008008n];
const ROTXY = [
  [0,36,3,41,18],
  [1,44,10,45,2],
  [62,6,43,15,61],
  [28,55,25,21,56],
  [27,20,39,8,14],
]; // ROTXY[x][y]
function keccakF(state){ // state: array 25 BigInt, index x+5*y
  for(let round=0; round<24; round++){
    // Theta
    const C = new Array(5), D = new Array(5);
    for(let x=0;x<5;x++) C[x] = state[x] ^ state[x+5] ^ state[x+10] ^ state[x+15] ^ state[x+20];
    for(let x=0;x<5;x++) D[x] = C[(x+4)%5] ^ rotl64(C[(x+1)%5],1);
    for(let x=0;x<5;x++) for(let y=0;y<5;y++) state[x+5*y] ^= D[x];
    // Rho + Pi
    const B = new Array(25);
    for(let x=0;x<5;x++) for(let y=0;y<5;y++){
      const nx = y, ny = (2*x+3*y)%5;
      B[nx+5*ny] = rotl64(state[x+5*y], ROTXY[x][y]);
    }
    // Chi
    for(let x=0;x<5;x++) for(let y=0;y<5;y++){
      state[x+5*y] = B[x+5*y] ^ ((~B[((x+1)%5)+5*y]) & B[((x+2)%5)+5*y]);
    }
    state[0] ^= RC[round];
    for(let i=0;i<25;i++) state[i] &= MASK64;
  }
}
function bytesToLanes(bytes, offset, rate){
  const lanes = new Array(25).fill(0n);
  for(let i=0;i<rate;i++){
    const lane = Math.floor(i/8), shift = BigInt((i%8)*8);
    lanes[lane] |= BigInt(bytes[offset+i]) << shift;
  }
  return lanes;
}
function keccak256(inputBytes){
  const rate = 136;
  const state = new Array(25).fill(0n);
  // pad10*1, suffix 0x01
  const padded = [];
  for(const b of inputBytes) padded.push(b);
  padded.push(0x01);
  while(padded.length % rate !== 0) padded.push(0x00);
  padded[padded.length-1] |= 0x80;
  for(let off=0; off<padded.length; off+=rate){
    const lanes = bytesToLanes(padded, off, rate);
    for(let i=0;i<25;i++) state[i] ^= lanes[i];
    keccakF(state);
  }
  const out = [];
  for(let lane=0; lane<4; lane++){
    let v = state[lane];
    for(let i=0;i<8;i++){ out.push(Number(v & 0xffn)); v >>= 8n; }
  }
  return out.map((b) => b.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex){ hex = hex.replace(/^0x/,''); const out=[]; for(let i=0;i<hex.length;i+=2) out.push(parseInt(hex.slice(i,i+2),16)); return out; }
function utf8Bytes(s){ return Array.from(new TextEncoder().encode(s)); }
function ethPersonalHash(message){
  const msgBytes = utf8Bytes(message);
  const prefix = utf8Bytes("\x19Ethereum Signed Message:\n" + String(msgBytes.length));
  return keccak256([...prefix, ...msgBytes]);
}
// secp256k1
const P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2Fn;
const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
const Gx = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n;
const Gy = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n;
function mod(a,m){ const r=a%m; return r>=0n?r:r+m; }
function modInv(a,m){ let [old, nw]=[mod(a,m), m]; let [x, y]=[1n,0n]; while(nw!==0n){ const q=old/nw; [old,nw]=[nw, old-q*nw]; [x,y]=[y, x-q*y]; } return mod(x,m); }
function modPow(base, exp, m){ let r=1n, b=mod(base,m); while(exp>0n){ if(exp&1n) r=(r*b)%m; b=(b*b)%m; exp>>=1n; } return r; }
function pointAdd(P1,P2){
  if(!P1) return P2; if(!P2) return P1;
  const [x1,y1]=P1, [x2,y2]=P2;
  if(x1===x2 && mod(y1+y2,P)===0n) return null;
  let m;
  if(x1===x2 && y1===y2) m = mod((3n*x1*x1) * modInv(2n*y1,P), P);
  else m = mod((y2-y1) * modInv(mod(x2-x1,P),P), P);
  const x3 = mod(m*m - x1 - x2, P);
  const y3 = mod(m*(x1-x3) - y1, P);
  return [x3,y3];
}
function pointMul(k, Pt){
  let R=null, A=Pt, kk=k;
  while(kk>0n){ if(kk&1n) R=pointAdd(R,A); A=pointAdd(A,A); kk>>=1n; }
  return R;
}
function to32BytesHex(n){ return n.toString(16).padStart(64,'0'); }
function recoverAddress(message, signatureHex){
  const sig = signatureHex.replace(/^0x/,'');
  if(sig.length!==130) return null;
  const r = BigInt('0x'+sig.slice(0,64));
  const s = BigInt('0x'+sig.slice(64,128));
  let v = parseInt(sig.slice(128,130),16);
  if(v>=27) v-=27;
  if(v!==0 && v!==1) return null;
  if(r<=0n || r>=N || s<=0n || s>=N) return null;
  const hashHex = ethPersonalHash(message);
  const e = BigInt('0x'+hashHex);
  const x = r;
  if(x>=P) return null;
  const alpha = mod(modPow(x,3n,P)+7n,P);
  let y = modPow(alpha, (P+1n)/4n, P);
  if(mod(y*y,P)!==alpha) return null;
  if(Number(y & 1n)!==v) y = P - y;
  const R = [x,y];
  // n*R should be infinity
  if(pointMul(N,R)!==null) return null;
  const rInv = modInv(r,N);
  const Q = pointMul(rInv, pointAdd(pointMul(s,R), pointMul(mod(-e,N), [Gx,Gy])));
  if(!Q) return null;
  const pub = hexToBytes(to32BytesHex(Q[0]) + to32BytesHex(Q[1]));
  const h = keccak256(pub);
  return '0x' + h.slice(-40);
}

export async function onRequestGet({ request, env }) {
  const email = await sessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);
  if (!env.SPINWAVE_DB) return json({ error: 'not_configured' }, 500);
  const db = env.SPINWAVE_DB;
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS wallet_links (email TEXT PRIMARY KEY, address TEXT, message TEXT, signature TEXT, verified_at INTEGER, created_at INTEGER)',
    )
    .run();
  const row = await db
    .prepare('SELECT address, verified_at FROM wallet_links WHERE email = ?')
    .bind(email)
    .first();
  if (!row) return json({ verified: false, address: null }, 200);
  return json({ verified: true, address: row.address, verified_at: row.verified_at }, 200);
}

export async function onRequestPost({ request, env }) {
  const email = await sessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);
  if (!env.SPINWAVE_DB) return json({ error: 'not_configured' }, 500);
  let body = null;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const address = String((body && body.address) || '').toLowerCase();
  const signature = String((body && body.signature) || '');
  if (!/^0x[0-9a-f]{40}$/.test(address)) return json({ error: 'bad_wallet' }, 400);
  if (!/^0x[0-9a-f]{130}$/.test(signature)) return json({ error: 'bad_signature' }, 400);
  const db = env.SPINWAVE_DB;
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS wallet_nonces (email TEXT, address TEXT, nonce TEXT, message TEXT, expires_at INTEGER, used INTEGER DEFAULT 0, created_at INTEGER, PRIMARY KEY(email, nonce))',
    )
    .run();
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS wallet_links (email TEXT PRIMARY KEY, address TEXT, message TEXT, signature TEXT, verified_at INTEGER, created_at INTEGER)',
    )
    .run();
  // Find the caller's most recent unused, unexpired nonce for this address.
  const nonceRow = await db
    .prepare(
      'SELECT nonce, message, expires_at, used FROM wallet_nonces WHERE email = ? AND address = ? AND used = 0 ORDER BY created_at DESC LIMIT 1',
    )
    .bind(email, address)
    .first();
  if (!nonceRow) return json({ error: 'no_nonce' }, 400);
  const now = Math.floor(Date.now() / 1000);
  if (nonceRow.expires_at < now) return json({ error: 'nonce_expired' }, 400);
  let recovered = null;
  try {
    recovered = recoverAddress(nonceRow.message, signature);
  } catch {
    recovered = null;
  }
  if (!recovered || recovered.toLowerCase() !== address) {
    return json({ error: 'bad_signature' }, 400);
  }
  await db
    .prepare('UPDATE wallet_nonces SET used = 1 WHERE email = ? AND nonce = ?')
    .bind(email, nonceRow.nonce)
    .run();
  await db
    .prepare(
      `INSERT INTO wallet_links (email, address, message, signature, verified_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET address = excluded.address, message = excluded.message,
         signature = excluded.signature, verified_at = excluded.verified_at`,
    )
    .bind(email, address, nonceRow.message, signature, now, now)
    .run();
  return json({ verified: true, address, verified_at: now }, 200);
}
