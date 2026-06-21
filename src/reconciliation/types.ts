/**
 * Reconciliation control-plane types (issue #8).
 *
 * The indexer produces *derived* state; these types model the independent
 * control plane that proves the PostgreSQL projections still match authoritative
 * chain evidence at a reproducible ledger boundary. See
 * `docs/reconciliation-control-plane.md` for the full design.
 */

/** Protocol domains that have a canonical on-chain representation to reconcile. */
export type ProtocolDomain =
  | 'treasury'
  | 'payroll_stream'
  | 'vesting'
  | 'governance';

/** Lifecycle of a single reconciliation run. */
export type RunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

/**
 * How a discrepancy manifests. Kept deliberately fine-grained so an operator can
 * tell an ingestion gap from a decoder regression from an RPC/historical-state
 * problem without re-running the comparison.
 */
export type DiscrepancyKind =
  | 'missing' // on chain, absent from the projection
  | 'unexpected' // in the projection, absent from chain
  | 'stale' // projection lags a newer chain version
  | 'value_mismatch' // same entity, differing field value(s)
  | 'invalid_transition' // projected status path is unreachable on chain
  | 'aggregate_mismatch' // per-row equal but a rollup (sum/count) disagrees
  | 'decode_failure' // chain event could not be decoded at this decoder version
  | 'unavailable_historical_state' // RPC could not serve the pinned ledger
  | 'unsupported_contract_version'; // contract WASM hash is outside the registry

/** Repair posture. The control plane defaults to observe-only. */
export type RepairMode = 'report_only' | 'repair';

/** Severity an operator triages on. */
export type DiscrepancySeverity = 'info' | 'warning' | 'critical';

/**
 * The immutable identity of a run: every input that could change the verdict is
 * pinned so a run is exactly reproducible and auditable.
 */
export interface RunPin {
  networkPassphrase: string;
  rpcEndpointId: string;
  contractRegistryVersion: string;
  /** contractId -> deployed WASM hash, so an upgrade is detectable. */
  contractWasmHashes: Record<string, string>;
  /** The ledger sequence every comparison is taken at. */
  pinnedLedger: number;
  decoderVersion: string;
  schemaVersion: string;
}

/**
 * A canonical entity to compare: a stable id, the domain, the version/ledger it
 * was observed at, the exact base-unit fields, and a deterministic fingerprint
 * of the normalized value (see `canonical.ts`).
 */
export interface CanonicalEntity {
  id: string;
  domain: ProtocolDomain;
  /** Ledger (chain) or row version (projection) this snapshot reflects. */
  version: number;
  fingerprint: string;
  /** Normalized, comparison-ready value (base units as decimal strings). */
  value: Record<string, unknown>;
}

/** One classified difference between chain and projection for an entity. */
export interface Discrepancy {
  domain: ProtocolDomain;
  entityId: string;
  kind: DiscrepancyKind;
  severity: DiscrepancySeverity;
  /** Field-level detail for value mismatches; empty otherwise. */
  fields: DiscrepancyField[];
  expectedFingerprint?: string;
  observedFingerprint?: string;
  detail: string;
}

export interface DiscrepancyField {
  path: string;
  expected: string | null;
  observed: string | null;
}

/** Outcome of comparing one domain's chain snapshot against its projection. */
export interface DomainComparison {
  domain: ProtocolDomain;
  checkedCount: number;
  discrepancies: Discrepancy[];
}
