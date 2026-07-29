"use strict";
/**
 * Reconciliation control plane (issue #8) — public surface.
 *
 * This is the foundation slice (PR 1): the run/discrepancy model, the canonical
 * comparison primitives, and the pure report-only comparison. Chain evidence
 * collection, the distributed lease, repair execution, and shadow-rebuild land
 * in follow-up PRs per `docs/reconciliation-control-plane.md`.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isClean = exports.compareDomain = exports.sortBy = exports.fingerprint = exports.canonicalString = exports.normalize = exports.amountsEqual = exports.compareAmounts = exports.toBaseUnits = void 0;
__exportStar(require("./types"), exports);
var canonical_1 = require("./canonical");
Object.defineProperty(exports, "toBaseUnits", { enumerable: true, get: function () { return canonical_1.toBaseUnits; } });
Object.defineProperty(exports, "compareAmounts", { enumerable: true, get: function () { return canonical_1.compareAmounts; } });
Object.defineProperty(exports, "amountsEqual", { enumerable: true, get: function () { return canonical_1.amountsEqual; } });
Object.defineProperty(exports, "normalize", { enumerable: true, get: function () { return canonical_1.normalize; } });
Object.defineProperty(exports, "canonicalString", { enumerable: true, get: function () { return canonical_1.canonicalString; } });
Object.defineProperty(exports, "fingerprint", { enumerable: true, get: function () { return canonical_1.fingerprint; } });
Object.defineProperty(exports, "sortBy", { enumerable: true, get: function () { return canonical_1.sortBy; } });
var compare_1 = require("./compare");
Object.defineProperty(exports, "compareDomain", { enumerable: true, get: function () { return compare_1.compareDomain; } });
Object.defineProperty(exports, "isClean", { enumerable: true, get: function () { return compare_1.isClean; } });
