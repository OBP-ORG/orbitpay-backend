"use strict";
/**
 * Canonical comparison primitives for reconciliation (issue #8).
 *
 * Money is compared as exact base-unit integers — never JavaScript or SQL
 * floating point. Snapshots from chain and from the projection are normalized to
 * a canonical form (sorted keys, base units as decimal strings, ordering and
 * optional/default fields normalized) and reduced to a deterministic fingerprint
 * so two snapshots are equal iff their fingerprints match.
 *
 * Pure and dependency-free (only `node:crypto`), so it is trivially testable and
 * safe to run anywhere in the pipeline.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.toBaseUnits = toBaseUnits;
exports.compareAmounts = compareAmounts;
exports.amountsEqual = amountsEqual;
exports.normalize = normalize;
exports.canonicalString = canonicalString;
exports.fingerprint = fingerprint;
exports.sortBy = sortBy;
const node_crypto_1 = require("node:crypto");
/**
 * Coerce a base-unit amount to an exact bigint, rejecting anything that could
 * silently lose precision. Accepts a bigint, an integer-valued number that is
 * still safe, or a decimal string of an integer. Floats, NaN, Infinity, and
 * non-integers throw — this is the guard against floating-point money.
 */
function toBaseUnits(value) {
    if (typeof value === 'bigint')
        return value;
    if (typeof value === 'number') {
        if (!Number.isInteger(value)) {
            throw new TypeError(`base-unit amount must be an integer, got ${value}`);
        }
        if (!Number.isSafeInteger(value)) {
            throw new TypeError(`base-unit amount ${value} exceeds Number.MAX_SAFE_INTEGER; pass a string or bigint`);
        }
        return BigInt(value);
    }
    if (typeof value === 'string') {
        if (!/^-?\d+$/.test(value.trim())) {
            throw new TypeError(`base-unit amount must be an integer string, got "${value}"`);
        }
        return BigInt(value.trim());
    }
    throw new TypeError(`unsupported base-unit amount type: ${typeof value}`);
}
/** Exact three-way comparison of two base-unit amounts. */
function compareAmounts(a, b) {
    const x = toBaseUnits(a);
    const y = toBaseUnits(b);
    if (x < y)
        return -1;
    if (x > y)
        return 1;
    return 0;
}
/** True iff two base-unit amounts are exactly equal. */
function amountsEqual(a, b) {
    return compareAmounts(a, b) === 0;
}
/**
 * Normalize an arbitrary value into canonical form:
 *  - object keys sorted, `undefined` / nullish-default fields dropped;
 *  - bigints rendered as decimal strings (exact);
 *  - numbers required to be integers (floats are a bug here) and stringified;
 *  - arrays normalized element-wise (order preserved — callers sort
 *    order-insensitive collections via {@link sortBy} before normalizing).
 */
function normalize(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === 'bigint')
        return value.toString();
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new TypeError(`cannot canonicalize non-finite number ${value}`);
        }
        if (!Number.isInteger(value)) {
            throw new TypeError(`refusing to canonicalize a non-integer number (${value}); convert money to base-unit strings first`);
        }
        return value.toString();
    }
    if (typeof value === 'boolean')
        return value;
    if (typeof value === 'string')
        return value;
    if (value instanceof Date)
        return value.toISOString();
    if (Array.isArray(value))
        return value.map((v) => normalize(v));
    if (typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value).sort()) {
            const v = value[key];
            if (v === undefined || v === null)
                continue; // drop optional/default-absent fields
            out[key] = normalize(v);
        }
        return out;
    }
    throw new TypeError(`cannot canonicalize value of type ${typeof value}`);
}
/** Deterministic, key-order-independent string for a canonical value. */
function canonicalString(value) {
    return JSON.stringify(normalize(value));
}
/** Deterministic fingerprint (sha256 hex) of a value's canonical form. */
function fingerprint(value) {
    return (0, node_crypto_1.createHash)('sha256').update(canonicalString(value)).digest('hex');
}
/** Stable sort helper for order-insensitive collections, by a derived key. */
function sortBy(items, key) {
    return [...items].sort((a, b) => {
        const ka = key(a);
        const kb = key(b);
        return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
}
