# Record — SpinWave

> A validated SpinWave record, with its pipeline state and, once confirmed, its Base anchor.

Canonical: https://spinwave.tech/records.html
Last updated: 2026-10-29

## At a glance

A record is certified only when its anchor has confirmed on Base. An anchor shown as pending is not a certificate, and a record without a payment reference was never paid through this pipeline.

| Field | What it means |
|---|---|
| Record ID | The record's id, as in `/records?id=<id>` |
| Title / Authors / Version | From the validated record |
| Scholar wallet | The scholar's wallet, when recorded |
| State | Pipeline state, e.g. certified |
| Anchor (Base hash) | The Base anchor transaction, once confirmed |
| Anchor confirmations | 12 required for certification |
| Document fingerprint | Recorded on transfer |
| Certificate | Issued only after the anchor confirms |

## Record
A record is certified only when its anchor has confirmed on Base. An anchor shown as pending is not a certificate, and a record without a payment reference was never paid through this pipeline.

## Related

- [Certificate — SpinWave](https://spinwave.tech/certificate.html)
- [Trust Center — SpinWave](https://spinwave.tech/trust.html)

