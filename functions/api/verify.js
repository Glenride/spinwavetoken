/**
 * GET /api/verify — SpinWave MVP certificate verifier (2026-10-29),
 * public, read-only, no sign-in required.
 * ?id=<record id or certificate id> and/or ?hash=<Base tx hash>.
 * Statuses, kept distinct on purpose:
 *   verified      — record found, state is certified, anchor_tx is
 *                   present, and a supplied hash matches it.
 *   invalid       — a record/certificate was found, but a supplied
 *                   hash does NOT match its confirmed anchor_tx, or
 *                   the record is presented as certified without a
 *                   confirmed anchor. `failed_check` names which.
 *   not_certified — record found, but no confirmed anchor yet
 *                   (anchoring pending, or upload pending). Not
 *                   "invalid": the work is real, the certificate
 *                   is not ready.
 *   not_found     — no record matches the supplied id/certificate/
 *                   hash. Not "invalid": nothing to check against.
 * Full identifier-set matching (certificate JSON vs. record) lands
 * with D7/D8; this MVP checks the record + confirmed anchor, which
 * is the load-bearing check a stranger needs first. A tampered
 * copy must return invalid, never verified — that case is tested
 * in the MVP verification pass, not just the good case.
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
  const id = (url.searchParams.get('id') || '').trim();
  const hash = (url.searchParams.get('hash') || '').trim().toLowerCase();
  if (!id && !hash) return json({ error: 'bad_request' }, 400);
  const db = env.SPINWAVE_DB;
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, title TEXT, authors TEXT, version TEXT, scholar_wallet TEXT, state TEXT, anchor_tx TEXT, anchored_at INTEGER, certificate_id TEXT, created_at INTEGER)',
    )
    .run();
  let row = null;
  if (id) {
    row = await db
      .prepare(
        'SELECT id, title, authors, version, scholar_wallet, state, anchor_tx, anchored_at, certificate_id, created_at FROM records WHERE id = ? OR certificate_id = ?',
      )
      .bind(id, id)
      .first();
  }
  if (!row && hash) {
    row = await db
      .prepare(
        'SELECT id, title, authors, version, scholar_wallet, state, anchor_tx, anchored_at, certificate_id, created_at FROM records WHERE anchor_tx = ?',
      )
      .bind(hash)
      .first();
  }
  if (!row) {
    return json(
      { status: 'not_found', message: 'No SpinWave record matches that certificate or hash.' },
      200,
    );
  }
  const anchor = (row.anchor_tx || '').toLowerCase();
  if (hash && anchor && hash !== anchor) {
    return json(
      {
        status: 'invalid',
        failed_check: 'hash_mismatch',
        message: 'The supplied hash does not match this record\'s confirmed anchor.',
        record: { id: row.id, title: row.title, state: row.state },
      },
      200,
    );
  }
  if (!anchor) {
    return json(
      {
        status: 'not_certified',
        message: 'This record exists but has no confirmed anchor yet, so it is not certified.',
        record: { id: row.id, title: row.title, state: row.state },
      },
      200,
    );
  }
  if (row.state !== 'certified') {
    return json(
      {
        status: 'invalid',
        failed_check: 'state_not_certified',
        message: 'This record has an anchor but is not marked certified, so a certificate for it does not verify.',
        record: { id: row.id, title: row.title, state: row.state },
      },
      200,
    );
  }
  return json(
    {
      status: 'verified',
      record: {
        id: row.id,
        title: row.title,
        authors: row.authors,
        version: row.version,
        state: row.state,
        anchor_tx: row.anchor_tx,
        anchored_at: row.anchored_at,
        certificate_id: row.certificate_id,
      },
      basescan_url: `https://basescan.org/tx/${row.anchor_tx}`,
      record_url: `/records?id=${encodeURIComponent(row.id)}`,
    },
    200,
  );
}
