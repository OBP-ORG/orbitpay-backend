"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const router = (0, express_1.Router)();
// POST /auth/nonce — issue a challenge nonce for a wallet address
router.post('/nonce', (0, validate_1.bodyFields)(['walletAddress']), (req, res, next) => {
    (0, auth_1.handleNonce)(req, res).catch(next);
});
// POST /auth/verify — verify wallet signature and issue a JWT
router.post('/verify', (0, validate_1.bodyFields)(['walletAddress', 'signature']), (req, res, next) => {
    (0, auth_1.handleVerify)(req, res).catch(next);
});
exports.default = router;
