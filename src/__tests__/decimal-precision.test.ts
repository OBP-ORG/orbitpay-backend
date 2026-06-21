import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';

const decimalReplacer = (_key: string, value: unknown): unknown => {
  if (value instanceof Prisma.Decimal) return value.toFixed();
  return value;
};

test('minimum positive value preserves 7 decimal places', () => {
  const d = new Prisma.Decimal('0.0000001');
  assert.strictEqual(d.toFixed(), '0.0000001');
});

test('maximum NUMERIC(36,7) value is representable without overflow', () => {
  const max = new Prisma.Decimal('9'.repeat(29) + '.' + '9'.repeat(7));
  assert.ok(max.greaterThan(0));
  assert.strictEqual(max.toFixed(), '9'.repeat(29) + '.' + '9'.repeat(7));
});

test('large amount with 7 decimal places survives round-trip', () => {
  const d = new Prisma.Decimal('10000000000.0000001');
  assert.strictEqual(d.toFixed(), '10000000000.0000001');
});

test('Decimal.mul avoids binary float error on large amounts', () => {
  const amount = new Prisma.Decimal('10000000000.0000001');
  const half = amount.mul(new Prisma.Decimal('0.5'));
  assert.strictEqual(half.toFixed(), '5000000000.00000005');
});

test('JSON replacer serialises Decimal as exact decimal string, not object', () => {
  const payload = { amount: new Prisma.Decimal('1234567.8901234') };
  const json = JSON.stringify(payload, decimalReplacer);
  const parsed = JSON.parse(json) as { amount: string };
  assert.strictEqual(typeof parsed.amount, 'string');
  assert.strictEqual(parsed.amount, '1234567.8901234');
});

test('JSON replacer serialises small values in decimal notation, not scientific', () => {
  const payload = { amount: new Prisma.Decimal('0.0000001') };
  const json = JSON.stringify(payload, decimalReplacer);
  const parsed = JSON.parse(json) as { amount: string };
  assert.strictEqual(parsed.amount, '0.0000001');
});

test('JSON replacer passes null through unchanged', () => {
  const payload = { amount: null };
  const json = JSON.stringify(payload, decimalReplacer);
  const parsed = JSON.parse(json) as { amount: null };
  assert.strictEqual(parsed.amount, null);
});

test('zero is serialised as "0", not "{}"', () => {
  const d = new Prisma.Decimal('0');
  const json = JSON.stringify({ amount: d }, decimalReplacer);
  assert.strictEqual(json, '{"amount":"0"}');
});
