import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compareDomain, isClean } from './compare';
import { fingerprint } from './canonical';
import type { CanonicalEntity } from './types';

function entity(id: string, version: number, value: Record<string, unknown>): CanonicalEntity {
  return { id, domain: 'treasury', version, fingerprint: fingerprint(value), value };
}

test('identical chain and projection produce no discrepancies', () => {
  const chain = [entity('t1', 1, { balance: '1000' })];
  const projected = [entity('t1', 1, { balance: '1000' })];
  const result = compareDomain('treasury', chain, projected);
  assert.ok(isClean(result));
  assert.equal(result.checkedCount, 1);
});

test('entity on chain but absent from projection is missing/critical', () => {
  const result = compareDomain('treasury', [entity('t1', 1, { balance: '1000' })], []);
  assert.equal(result.discrepancies.length, 1);
  assert.equal(result.discrepancies[0].kind, 'missing');
  assert.equal(result.discrepancies[0].severity, 'critical');
});

test('entity in projection but absent from chain is unexpected/critical', () => {
  const result = compareDomain('treasury', [], [entity('t1', 1, { balance: '1000' })]);
  assert.equal(result.discrepancies[0].kind, 'unexpected');
  assert.equal(result.discrepancies[0].severity, 'critical');
});

test('same version with differing value is a value_mismatch with field detail', () => {
  const chain = [entity('t1', 2, { balance: '1000' })];
  const projected = [entity('t1', 2, { balance: '999' })];
  const result = compareDomain('treasury', chain, projected);
  const d = result.discrepancies[0];
  assert.equal(d.kind, 'value_mismatch');
  assert.equal(d.severity, 'critical');
  assert.deepEqual(d.fields, [{ path: 'balance', expected: '1000', observed: '999' }]);
});

test('older projection version is classified as stale/warning, not a mismatch', () => {
  const chain = [entity('t1', 5, { balance: '1000' })];
  const projected = [entity('t1', 3, { balance: '900' })];
  const result = compareDomain('treasury', chain, projected);
  assert.equal(result.discrepancies[0].kind, 'stale');
  assert.equal(result.discrepancies[0].severity, 'warning');
});

test('discrepancies are emitted in a deterministic id order', () => {
  const chain = [entity('b', 1, { v: '1' }), entity('a', 1, { v: '1' })];
  const result = compareDomain('treasury', chain, []);
  assert.deepEqual(
    result.discrepancies.map((d) => d.entityId),
    ['a', 'b'],
  );
});
