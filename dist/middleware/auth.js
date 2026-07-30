"use strict";
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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireOrgMember = exports.requireOrgAdmin = exports.requireAuth = exports.handleVerify = exports.handleNonce = exports.verifyWalletSignature = exports.issueNonce = exports.buildChallengeMessage = void 0;
const crypto_1 = require("crypto");
const stellar_sdk_1 = require("@stellar/stellar-sdk");
const redis_1 = require("../lib/redis");
const logger_1 = require("../lib/logger");
const jwt_1 = require("../lib/jwt");
const NONCE_TTL_SECONDS = 300; // 5 minutes
const NONCE_PREFIX = 'orbitpay:nonce:';
/** Build the exact string the client must sign. */
const buildChallengeMessage = (nonce) => `OrbitPay authentication nonce: ${nonce}`;
exports.buildChallengeMessage = buildChallengeMessage;
/** Issue a fresh nonce tied to a wallet address, stored in Redis (single-use). */
const issueNonce = async (walletAddress) => {
    const nonce = (0, crypto_1.randomBytes)(32).toString('hex');
    const redis = await (0, redis_1.getRedisClient)();
    await redis.set(`${NONCE_PREFIX}${walletAddress}`, nonce, {
        EX: NONCE_TTL_SECONDS,
    });
    return nonce;
};
exports.issueNonce = issueNonce;
/** Consume (delete) the nonce; returns it or null if missing/expired. */
const consumeNonce = async (walletAddress) => {
    const redis = await (0, redis_1.getRedisClient)();
    const key = `${NONCE_PREFIX}${walletAddress}`;
    // Atomic get-then-delete to prevent replay within the TTL window
    const nonce = await redis.getDel(key);
    return nonce ?? null;
};
/**
 * Verify an Ed25519 signature produced by a Stellar wallet.
 *
 * Uses `Keypair.fromPublicKey` from `@stellar/stellar-sdk` which:
 *   - Decodes the StrKey (base32 + version byte + CRC-16 checksum) correctly.
 *   - Validates the raw Ed25519 key length (must be exactly 32 bytes).
 *   - Delegates signature verification to the SDK's Ed25519 primitive.
 *
 * The client signs `buildChallengeMessage(nonce)` (UTF-8) with their Ed25519
 * secret key and submits the 64-byte signature base64-encoded.
 */
const verifyWalletSignature = (walletAddress, signature, nonce) => {
    try {
        const keypair = stellar_sdk_1.Keypair.fromPublicKey(walletAddress);
        const message = Buffer.from((0, exports.buildChallengeMessage)(nonce), 'utf8');
        const sigBuf = Buffer.from(signature, 'base64');
        return keypair.verify(message, sigBuf);
    }
    catch {
        return false;
    }
};
exports.verifyWalletSignature = verifyWalletSignature;
/** POST /auth/nonce handler — issues a challenge nonce for a wallet address. */
const handleNonce = async (req, res) => {
    const { walletAddress } = req.body;
    if (typeof walletAddress !== 'string' || !/^G[A-Z2-7]{55}$/.test(walletAddress)) {
        res.status(400).json({
            error: 'Bad Request',
            message: 'walletAddress must be a valid Stellar public key',
            requestId: req.requestId,
        });
        return;
    }
    const nonce = await (0, exports.issueNonce)(walletAddress);
    logger_1.logger.info(req, 'Nonce issued', { walletAddress });
    res.json({
        walletAddress,
        nonce,
        message: (0, exports.buildChallengeMessage)(nonce),
        expiresInSeconds: NONCE_TTL_SECONDS,
    });
};
exports.handleNonce = handleNonce;
/** POST /auth/verify handler — verifies signature and returns a JWT. */
const handleVerify = async (req, res) => {
    const { walletAddress, signature } = req.body;
    if (typeof walletAddress !== 'string' || !/^G[A-Z2-7]{55}$/.test(walletAddress)) {
        res.status(400).json({
            error: 'Bad Request',
            message: 'walletAddress must be a valid Stellar public key',
            requestId: req.requestId,
        });
        return;
    }
    if (typeof signature !== 'string' || signature.length === 0 || signature.length > 512) {
        res.status(400).json({
            error: 'Bad Request',
            message: 'signature is required (base64-encoded Ed25519 signature)',
            requestId: req.requestId,
        });
        return;
    }
    const nonce = await consumeNonce(walletAddress);
    if (!nonce) {
        res.status(401).json({
            error: 'Unauthorized',
            message: 'Nonce not found or expired. Request a new nonce.',
            requestId: req.requestId,
        });
        return;
    }
    const valid = (0, exports.verifyWalletSignature)(walletAddress, signature, nonce);
    if (!valid) {
        logger_1.logger.warn(req, 'Invalid wallet signature', { walletAddress });
        res.status(401).json({
            error: 'Unauthorized',
            message: 'Signature verification failed.',
            requestId: req.requestId,
        });
        return;
    }
    const token = (0, jwt_1.signJwt)({ sub: walletAddress });
    logger_1.logger.info(req, 'Wallet authenticated', { walletAddress });
    res.json({ token });
};
exports.handleVerify = handleVerify;
/** Express middleware — require a valid JWT in Authorization: Bearer <token>. */
const requireAuth = (req, res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        res.status(401).json({
            error: 'Unauthorized',
            message: 'Missing or malformed Authorization header.',
            requestId: req.requestId,
        });
        return;
    }
    const token = header.slice(7);
    const payload = (0, jwt_1.verifyJwt)(token);
    if (!payload) {
        res.status(401).json({
            error: 'Unauthorized',
            message: 'Invalid or expired token.',
            requestId: req.requestId,
        });
        return;
    }
    req.walletAddress = payload.sub;
    next();
};
exports.requireAuth = requireAuth;
/** Middleware — verify the authenticated wallet is the admin of :orgId. */
const requireOrgAdmin = async (req, res, next) => {
    const { prisma } = await Promise.resolve().then(() => __importStar(require('../lib/prisma')));
    const orgId = String(req.params.orgId);
    if (!orgId) {
        res.status(400).json({
            error: 'Bad Request',
            message: 'orgId path parameter is required',
            requestId: req.requestId,
        });
        return;
    }
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) {
        res.status(404).json({
            error: 'Not Found',
            message: 'Organization not found',
            requestId: req.requestId,
        });
        return;
    }
    if (org.admin !== req.walletAddress) {
        logger_1.logger.warn(req, 'Cross-org access denied', {
            orgId,
            requester: req.walletAddress,
        });
        res.status(403).json({
            error: 'Forbidden',
            message: 'You are not the admin of this organization.',
            requestId: req.requestId,
        });
        return;
    }
    req.organization = org;
    next();
};
exports.requireOrgAdmin = requireOrgAdmin;
/** Middleware — verify the authenticated wallet belongs to :orgId (as admin or member). */
const requireOrgMember = async (req, res, next) => {
    const { prisma } = await Promise.resolve().then(() => __importStar(require('../lib/prisma')));
    const orgId = String(req.params.orgId);
    if (!orgId) {
        res.status(400).json({
            error: 'Bad Request',
            message: 'orgId path parameter is required',
            requestId: req.requestId,
        });
        return;
    }
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) {
        res.status(404).json({
            error: 'Not Found',
            message: 'Organization not found',
            requestId: req.requestId,
        });
        return;
    }
    // Check admin or beneficiary/sender in streams/vesting within this org
    const wallet = req.walletAddress;
    if (org.admin !== wallet) {
        const [stream, vesting] = await Promise.all([
            prisma.stream.findFirst({
                where: {
                    organizationId: orgId,
                    OR: [{ sender: wallet }, { recipient: wallet }],
                },
            }),
            prisma.vestingSchedule.findFirst({
                where: {
                    organizationId: orgId,
                    OR: [{ grantor: wallet }, { beneficiary: wallet }],
                },
            }),
        ]);
        if (!stream && !vesting) {
            logger_1.logger.warn(req, 'Cross-org access denied (member check)', {
                orgId,
                requester: wallet,
            });
            res.status(403).json({
                error: 'Forbidden',
                message: 'You do not have access to this organization.',
                requestId: req.requestId,
            });
            return;
        }
    }
    req.organization = org;
    next();
};
exports.requireOrgMember = requireOrgMember;
