# Reconciliation, drift forensics & zero-downtime projection repair

> Design document for issue #8. This is the architecture; it is delivered with a
> foundational implementation slice (the run/discrepancy model + the canonical
> comparison core) and is followed by the implementation PRs listed at the end.

## Problem

The OrbitPay indexer is a **derived-state pipeline, not a source of truth**.
Even with resumable, idempotent ingestion, the PostgreSQL projections can drift
from chain reality: missed ledger ranges, decoder regressions, contract
upgrades, RPC inconsistencies, partial migrations, or manual DB edits all corrupt
projections silently.

We need an **independent control plane** that can:

1. Prove what was checked, at a reproducible ledger boundary.
2. Explain every discrepancy with enough forensic evidence to attribute the
   cause (ingestion vs decode vs schema vs RPC vs operator).
3. Repair or shadow-rebuild projections **without** mutating chain state or
   interrupting reads.

A reconciliation engine is a correctness amplifier or a correctness destroyer:
an over-eager repair masks real loss, an under-eager one floods ops. So the
design is **report-only by default**, exact-integer throughout, and every
mutation is gated, planned, checksummed, and reversible in audit.

## Components

```
                ┌──────────────────────────────────────────────┐
   chain RPC ──▶│  evidence collector  (pinned ledger, XDR)     │
                └───────────────┬──────────────────────────────┘
                                ▼ canonical snapshot (base units, fingerprint)
   projection ─▶  canonical projector ─▶  comparator  ─▶  discrepancies
                                                │
                          ┌─────────────────────┼─────────────────────┐
                          ▼                      ▼                     ▼
                    evidence store        repair planner        shadow rebuild
                    (immutable)        (report→plan→apply)     (build + cutover)
```

This PR implements the **canonical projector ↔ comparator** core and the
**run/discrepancy data model**. The rest is specified below and lands in
follow-ups.

## 1. Reconciliation run model

Every run persists an immutable **pin** of all inputs that could change its
verdict (`RunPin` in `src/reconciliation/types.ts`):

- network passphrase, RPC endpoint identity,
- contract registry version, contract IDs → deployed WASM hashes,
- the **pinned ledger** every comparison is taken at,
- decoder version, DB schema version,
- start/end time, terminal status (`RunStatus`).

Pinning makes a run **exactly reproducible** and lets us detect a contract
upgrade (WASM hash change) or a schema migration mid-flight.

- **Distributed lease.** A run (or a cutover) acquires a Redis lease keyed by
  `domain + projection`, so only one conflicting operation runs at a time.
  Leases are fenced (monotonic token) so a paused run cannot resume over a newer
  one.
- **Resumable shards.** Work is partitioned into bounded shards with explicit
  high-water marks, persisted as the run progresses, so cancellation, timeout,
  or a crash resumes without losing completed comparison work.

## 2. Canonical comparison  *(implemented in this PR)*

`src/reconciliation/canonical.ts` + `compare.ts`:

- **Exact base units only.** `toBaseUnits` coerces amounts to `bigint` and
  **rejects** floats, non-integers, NaN/Infinity, and unsafe-integer numbers.
  `compareAmounts` / `amountsEqual` compare exactly. No JavaScript or SQL
  floating point ever participates in a money comparison.

  > Note: the current projection schema stores amounts as `Float` (e.g.
  > `Stream.totalAmount`). The canonical layer treats those as a **migration
  > target** — a follow-up moves them to base-unit integer columns. Until then
  > the projector converts at the boundary and the float-ban guard flags any
  > value that cannot be represented exactly.

- **Normalization.** `normalize` sorts object keys, drops optional/default-absent
  fields, renders bigints as decimal strings, and normalizes dates — so two
  semantically-equal snapshots produce identical output regardless of key order
  or absent optionals. Order-insensitive collections are sorted via `sortBy`
  before hashing.

- **Deterministic fingerprints.** `fingerprint` is the sha256 of the canonical
  string; two entities are equal iff their fingerprints match.

- **Classification.** `compareDomain` (pure) diffs chain vs projection per entity
  and classifies each difference (`DiscrepancyKind`): `missing`, `unexpected`,
  `stale`, `value_mismatch`, `invalid_transition`, `aggregate_mismatch`,
  `decode_failure`, `unavailable_historical_state`, `unsupported_contract_version`.

Canonical snapshots are defined per domain: treasury config + withdrawals,
payroll streams + claims, vesting schedules + claims, and governance proposals,
membership, weights, and votes.

## 3. Evidence & forensics

Each discrepancy persists the forensic chain so the cause is attributable
**without re-running**:

- source ledger, transaction/event identifiers, raw XDR reference or checksum,
  decoded payload, projection row + version, expected vs observed value, decoder
  provenance.
- Discrepancy records are **immutable**; a resolution writes a linked,
  append-only **action** record (never an in-place edit).
- Secrets and auth material are **redacted** from all logs and evidence.
- Retention + export are defined for incident review.

## 4. Repair safety

- **Report-only by default** (`RepairMode = 'report_only'`).
- A repair requires: an authorized operator, explicit network + contract scope,
  ledger range, the specific discrepancy set, an idempotency key, a reason, and
  dry-run approval.
- A deterministic **repair plan** is generated; its checksum is approved before
  execution.
- Application uses transactional **compare-and-swap** guards (on row version) so
  any row changed after planning is never blindly overwritten.
- The control plane **never submits Soroban transactions** — it only repairs
  derived state.

## 5. Shadow rebuild & zero-downtime cutover

- A projection can be rebuilt in a **shadow** schema from the pinned ledger.
- Readers are proven never to observe partially-repaired or mixed-version state:
  cutover is an atomic pointer swap behind a fenced lease, with the schema
  version stamped so a reader can assert it read a single consistent version.

## 6. Observability

- Per-run metrics: entities checked, discrepancies by kind/severity, drift
  amount per domain, shard high-water marks, lease contention.
- A run emits a terminal summary; criticals page, warnings aggregate.

## Delivery plan (per the issue: design + several reviewable PRs)

1. **This PR** — design doc + run/discrepancy data model + canonical comparison
   core (`toBaseUnits`, `normalize`, `fingerprint`, `compareDomain`) with tests.
2. Evidence store + Prisma persistence of runs/discrepancies/actions wired to a
   first read-only domain (treasury).
3. Pinned-ledger evidence collector (Soroban historical state + XDR) and the
   canonical projectors for all four domains.
4. Distributed lease + resumable shards + run lifecycle.
5. Report-only reconciliation worker + metrics.
6. Gated repair planner/executor (compare-and-swap, idempotency, approval).
7. Shadow rebuild + zero-downtime cutover.
