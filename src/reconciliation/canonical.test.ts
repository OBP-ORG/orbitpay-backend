import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  toBaseUnits,
  compareAmounts,
  amountsEqual,
  normalize,
  canonicalString,
  fingerprint,
  sortBy,
} from './canonical';

test('toBaseUnits accepts exact integer representations', () => {
  assert.equal(toBaseUnits(10n), 10n);
  assert.equal(toBaseUnits(42), 42n);
  assert.equal(toBaseUnits('123456789012345678901234567890'), 123456789012345678901234567890n);
  assert.equal(toBaseUnits('-5'), -5n);
});

test('toBaseUnits rejects anything that could lose precision', () => {
  assert.throws(() => toBaseUnits(1.5), TypeError);
  assert.throws(() => toBaseUnits(Number.NaN), TypeError);
  assert.throws(() => toBaseUnits(Number.MAX_SAFE_INTEGER + 1), TypeError);
  assert.throws(() => toBaseUnits('1.0'), TypeError);
  assert.throws(() => toBaseUnits('abc'), TypeError);
});

test('amount comparison is exact, even past 2^53', () => {
  assert.equal(compareAmounts('9007199254740993', '9007199254740992'), 1);
  assert.equal(compareAmounts(100, 100n), 0);
  assert.equal(compareAmounts('5', 9), -1);
  assert.ok(amountsEqual('1000', 1000n));
  assert.ok(!amountsEqual('1000', '1001'));
});

test('normalize is key-order independent and drops nullish fields', () => {
  const a = normalize({ b: 2, a: 1, c: null, d: undefined });
  const b = normalize({ a: 1, b: 2 });
  assert.deepEqual(a, b);
});

test('normalize renders bigints as exact decimal strings and dates as ISO', () => {
  assert.equal(
    canonicalString({ amount: 10n, at: new Date('2026-01-01T00:00:00.000Z') }),
    '{"amount":"10","at":"2026-01-01T00:00:00.000Z"}',
  );
});

test('normalize refuses non-integer numbers (no float money)', () => {
  assert.throws(() => normalize({ amount: 1.23 }), TypeError);
  assert.throws(() => normalize(Number.POSITIVE_INFINITY), TypeError);
});

test('fingerprint is stable across key order and sensitive to value changes', () => {
  assert.equal(fingerprint({ a: 1, b: '2' }), fingerprint({ b: '2', a: 1 }));
  assert.notEqual(fingerprint({ a: 1 }), fingerprint({ a: 2 }));
});

test('sortBy gives a deterministic order for order-insensitive collections', () => {
  const items = [{ id: 'c' }, { id: 'a' }, { id: 'b' }];
  assert.deepEqual(
    sortBy(items, (i) => i.id).map((i) => i.id),
    ['a', 'b', 'c'],
  );
});
