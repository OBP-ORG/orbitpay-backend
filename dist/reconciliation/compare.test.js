"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const compare_1 = require("./compare");
const canonical_1 = require("./canonical");
function entity(id, version, value) {
    return { id, domain: 'treasury', version, fingerprint: (0, canonical_1.fingerprint)(value), value };
}
(0, node_test_1.test)('identical chain and projection produce no discrepancies', () => {
    const chain = [entity('t1', 1, { balance: '1000' })];
    const projected = [entity('t1', 1, { balance: '1000' })];
    const result = (0, compare_1.compareDomain)('treasury', chain, projected);
    strict_1.default.ok((0, compare_1.isClean)(result));
    strict_1.default.equal(result.checkedCount, 1);
});
(0, node_test_1.test)('entity on chain but absent from projection is missing/critical', () => {
    const result = (0, compare_1.compareDomain)('treasury', [entity('t1', 1, { balance: '1000' })], []);
    strict_1.default.equal(result.discrepancies.length, 1);
    strict_1.default.equal(result.discrepancies[0].kind, 'missing');
    strict_1.default.equal(result.discrepancies[0].severity, 'critical');
});
(0, node_test_1.test)('entity in projection but absent from chain is unexpected/critical', () => {
    const result = (0, compare_1.compareDomain)('treasury', [], [entity('t1', 1, { balance: '1000' })]);
    strict_1.default.equal(result.discrepancies[0].kind, 'unexpected');
    strict_1.default.equal(result.discrepancies[0].severity, 'critical');
});
(0, node_test_1.test)('same version with differing value is a value_mismatch with field detail', () => {
    const chain = [entity('t1', 2, { balance: '1000' })];
    const projected = [entity('t1', 2, { balance: '999' })];
    const result = (0, compare_1.compareDomain)('treasury', chain, projected);
    const d = result.discrepancies[0];
    strict_1.default.equal(d.kind, 'value_mismatch');
    strict_1.default.equal(d.severity, 'critical');
    strict_1.default.deepEqual(d.fields, [{ path: 'balance', expected: '1000', observed: '999' }]);
});
(0, node_test_1.test)('older projection version is classified as stale/warning, not a mismatch', () => {
    const chain = [entity('t1', 5, { balance: '1000' })];
    const projected = [entity('t1', 3, { balance: '900' })];
    const result = (0, compare_1.compareDomain)('treasury', chain, projected);
    strict_1.default.equal(result.discrepancies[0].kind, 'stale');
    strict_1.default.equal(result.discrepancies[0].severity, 'warning');
});
(0, node_test_1.test)('discrepancies are emitted in a deterministic id order', () => {
    const chain = [entity('b', 1, { v: '1' }), entity('a', 1, { v: '1' })];
    const result = (0, compare_1.compareDomain)('treasury', chain, []);
    strict_1.default.deepEqual(result.discrepancies.map((d) => d.entityId), ['a', 'b']);
});
