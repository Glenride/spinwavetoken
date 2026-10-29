/**
 * GET /api/records — SpinWave MVP (2026-10-29), public, read-only.
 * ?id=<record id> or ?certificate=<certificate id>.
 * Returns a validated SpinWave record if one exists, or 404
 * { error: 'not_found' } — a missing record is "not found", never
 * "invalid" and never a placeholder record. Records are created
 * only by the operator pipeline after payment succeeds; this
 * endpoint never creates one.
 * Anchor fields are null until confirmed — the UI must render
 * them as "pending", not blank and not certified.
 */

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestGet({ request, env }) {
  if (!env.SPINWAVE_DB) return json({ error: 'not_configured' }, 500);
  const url = new URL(request.url);
  const id = url.searchParams.get('id') || '';
  const cert = url.searchParams.get('certificate') || '';
  if (!id && !cert) return json({ error: 'bad_request' }, 400);
  const db = env.SPINWAVE_DB;
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, title TEXT, authors TEXT, version TEXT, scholar_wallet TEXT, state TEXT, anchor_tx TEXT, anchored_at INTEGER, certificate_id TEXT, created_at INTEGER)',
    )
    .run();
  for (const col of ['document_fingerprint TEXT', 'anchor_confirmations INTEGER', 'anchor_status TEXT']) {
    try {
      await db.prepare(`ALTER TABLE records ADD COLUMN ${col}`).run();
    } catch {}
  }
  let row = null;
  if (id) {
    row = await db
      .prepare(
        'SELECT id, title, authors, version, scholar_wallet, state, anchor_tx, anchored_at, certificate_id, created_at, document_fingerprint, anchor_confirmations, anchor_status FROM records WHERE id = ?',
      )
      .bind(id)
      .first();
  }
  if (!row && cert) {
    row = await db
      .prepare(
        'SELECT id, title, authors, version, scholar_wallet, state, anchor_tx, anchored_at, certificate_id, created_at, document_fingerprint, anchor_confirmations, anchor_status FROM records WHERE certificate_id = ?',
      )
      .bind(cert)
      .first();
  }
  if (!row) return json({ error: 'not_found' }, 404);
  return json({ record: row }, 200);
}
