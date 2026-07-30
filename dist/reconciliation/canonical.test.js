"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const canonical_1 = require("./canonical");
(0, node_test_1.test)('toBaseUnits accepts exact integer representations', () => {
    strict_1.default.equal((0, canonical_1.toBaseUnits)(10n), 10n);
    strict_1.default.equal((0, canonical_1.toBaseUnits)(42), 42n);
    strict_1.default.equal((0, canonical_1.toBaseUnits)('123456789012345678901234567890'), 123456789012345678901234567890n);
    strict_1.default.equal((0, canonical_1.toBaseUnits)('-5'), -5n);
});
(0, node_test_1.test)('toBaseUnits rejects anything that could lose precision', () => {
    strict_1.default.throws(() => (0, canonical_1.toBaseUnits)(1.5), TypeError);
    strict_1.default.throws(() => (0, canonical_1.toBaseUnits)(Number.NaN), TypeError);
    strict_1.default.throws(() => (0, canonical_1.toBaseUnits)(Number.MAX_SAFE_INTEGER + 1), TypeError);
    strict_1.default.throws(() => (0, canonical_1.toBaseUnits)('1.0'), TypeError);
    strict_1.default.throws(() => (0, canonical_1.toBaseUnits)('abc'), TypeError);
});
(0, node_test_1.test)('amount comparison is exact, even past 2^53', () => {
    strict_1.default.equal((0, canonical_1.compareAmounts)('9007199254740993', '9007199254740992'), 1);
    strict_1.default.equal((0, canonical_1.compareAmounts)(100, 100n), 0);
    strict_1.default.equal((0, canonical_1.compareAmounts)('5', 9), -1);
    strict_1.default.ok((0, canonical_1.amountsEqual)('1000', 1000n));
    strict_1.default.ok(!(0, canonical_1.amountsEqual)('1000', '1001'));
});
(0, node_test_1.test)('normalize is key-order independent and drops nullish fields', () => {
    const a = (0, canonical_1.normalize)({ b: 2, a: 1, c: null, d: undefined });
    const b = (0, canonical_1.normalize)({ a: 1, b: 2 });
    strict_1.default.deepEqual(a, b);
});
(0, node_test_1.test)('normalize renders bigints as exact decimal strings and dates as ISO', () => {
    strict_1.default.equal((0, canonical_1.canonicalString)({ amount: 10n, at: new Date('2026-01-01T00:00:00.000Z') }), '{"amount":"10","at":"2026-01-01T00:00:00.000Z"}');
});
(0, node_test_1.test)('normalize refuses non-integer numbers (no float money)', () => {
    strict_1.default.throws(() => (0, canonical_1.normalize)({ amount: 1.23 }), TypeError);
    strict_1.default.throws(() => (0, canonical_1.normalize)(Number.POSITIVE_INFINITY), TypeError);
});
(0, node_test_1.test)('fingerprint is stable across key order and sensitive to value changes', () => {
    strict_1.default.equal((0, canonical_1.fingerprint)({ a: 1, b: '2' }), (0, canonical_1.fingerprint)({ b: '2', a: 1 }));
    strict_1.default.notEqual((0, canonical_1.fingerprint)({ a: 1 }), (0, canonical_1.fingerprint)({ a: 2 }));
});
(0, node_test_1.test)('sortBy gives a deterministic order for order-insensitive collections', () => {
    const items = [{ id: 'c' }, { id: 'a' }, { id: 'b' }];
    strict_1.default.deepEqual((0, canonical_1.sortBy)(items, (i) => i.id).map((i) => i.id), ['a', 'b', 'c']);
});
