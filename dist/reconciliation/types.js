"use strict";
/**
 * Reconciliation control-plane types (issue #8).
 *
 * The indexer produces *derived* state; these types model the independent
 * control plane that proves the PostgreSQL projections still match authoritative
 * chain evidence at a reproducible ledger boundary. See
 * `docs/reconciliation-control-plane.md` for the full design.
 */
Object.defineProperty(exports, "__esModule", { value: true });
