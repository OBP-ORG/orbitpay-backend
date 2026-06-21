/**
 * Reconciliation control plane (issue #8) — public surface.
 *
 * This is the foundation slice (PR 1): the run/discrepancy model, the canonical
 * comparison primitives, and the pure report-only comparison. Chain evidence
 * collection, the distributed lease, repair execution, and shadow-rebuild land
 * in follow-up PRs per `docs/reconciliation-control-plane.md`.
 */

export * from './types';
export {
  toBaseUnits,
  compareAmounts,
  amountsEqual,
  normalize,
  canonicalString,
  fingerprint,
  sortBy,
} from './canonical';
export { compareDomain, isClean } from './compare';
