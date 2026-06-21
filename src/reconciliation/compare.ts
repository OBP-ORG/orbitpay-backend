/**
 * Pure comparison of a chain snapshot against a projected snapshot for one
 * protocol domain (issue #8). Produces classified discrepancies and never
 * mutates anything — this is the report-only heart of the control plane.
 */

import type {
  CanonicalEntity,
  Discrepancy,
  DiscrepancyField,
  DomainComparison,
  ProtocolDomain,
} from './types';

function index(entities: readonly CanonicalEntity[]): Map<string, CanonicalEntity> {
  const map = new Map<string, CanonicalEntity>();
  for (const e of entities) map.set(e.id, e);
  return map;
}

/** Field-level diff of two normalized values (one level deep over keys). */
function diffFields(
  expected: Record<string, unknown>,
  observed: Record<string, unknown>,
): DiscrepancyField[] {
  const fields: DiscrepancyField[] = [];
  const keys = new Set([...Object.keys(expected), ...Object.keys(observed)]);
  for (const path of [...keys].sort()) {
    const e = expected[path];
    const o = observed[path];
    const es = e === undefined || e === null ? null : String(e);
    const os = o === undefined || o === null ? null : String(o);
    if (es !== os) fields.push({ path, expected: es, observed: os });
  }
  return fields;
}

/**
 * Compare a domain's chain entities against its projected entities.
 *
 * - on chain, missing from projection  -> `missing` (critical: lost money/state)
 * - in projection, absent from chain   -> `unexpected` (critical: phantom state)
 * - both present, fingerprints differ:
 *     - projection older version        -> `stale` (warning)
 *     - same version, values differ     -> `value_mismatch` (critical)
 *
 * Pure: same inputs always yield the same discrepancies in a stable order.
 */
export function compareDomain(
  domain: ProtocolDomain,
  chain: readonly CanonicalEntity[],
  projected: readonly CanonicalEntity[],
): DomainComparison {
  const chainById = index(chain);
  const projById = index(projected);
  const discrepancies: Discrepancy[] = [];

  const allIds = [...new Set([...chainById.keys(), ...projById.keys()])].sort();

  for (const entityId of allIds) {
    const c = chainById.get(entityId);
    const p = projById.get(entityId);

    if (c && !p) {
      discrepancies.push({
        domain,
        entityId,
        kind: 'missing',
        severity: 'critical',
        fields: [],
        expectedFingerprint: c.fingerprint,
        detail: 'entity present on chain but absent from the projection',
      });
      continue;
    }

    if (p && !c) {
      discrepancies.push({
        domain,
        entityId,
        kind: 'unexpected',
        severity: 'critical',
        fields: [],
        observedFingerprint: p.fingerprint,
        detail: 'entity present in the projection but absent from chain',
      });
      continue;
    }

    if (c && p && c.fingerprint !== p.fingerprint) {
      const stale = p.version < c.version;
      discrepancies.push({
        domain,
        entityId,
        kind: stale ? 'stale' : 'value_mismatch',
        severity: stale ? 'warning' : 'critical',
        fields: diffFields(c.value, p.value),
        expectedFingerprint: c.fingerprint,
        observedFingerprint: p.fingerprint,
        detail: stale
          ? `projection at v${p.version} lags chain at v${c.version}`
          : 'projected value differs from chain at the same version',
      });
    }
  }

  return { domain, checkedCount: allIds.length, discrepancies };
}

/** True when a comparison found nothing to report (projection is sound). */
export function isClean(comparison: DomainComparison): boolean {
  return comparison.discrepancies.length === 0;
}
