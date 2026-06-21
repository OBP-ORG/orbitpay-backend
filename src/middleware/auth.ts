import { createPublicKey, createVerify, randomBytes } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { getRedisClient } from '../lib/redis';
import { logger } from '../lib/logger';
import { signJwt, verifyJwt } from '../lib/jwt';

const NONCE_TTL_SECONDS = 300; // 5 minutes
const NONCE_PREFIX = 'orbitpay:nonce:';

/** Build the exact string the client must sign. */
export const buildChallengeMessage = (nonce: string): string =>
  `OrbitPay authentication nonce: ${nonce}`;

/** Issue a fresh nonce tied to a wallet address, stored in Redis (single-use). */
export const issueNonce = async (walletAddress: string): Promise<string> => {
  const nonce = randomBytes(32).toString('hex');
  const redis = await getRedisClient();
  await redis.set(`${NONCE_PREFIX}${walletAddress}`, nonce, {
    EX: NONCE_TTL_SECONDS,
  });
  return nonce;
};

/** Consume (delete) the nonce; returns it or null if missing/expired. */
const consumeNonce = async (walletAddress: string): Promise<string | null> => {
  const redis = await getRedisClient();
  const key = `${NONCE_PREFIX}${walletAddress}`;
  // Atomic get-then-delete to prevent replay within the TTL window
  const nonce = await redis.getDel(key);
  return nonce ?? null;
};

/**
 * Verify an Ed25519 signature produced by a Stellar wallet.
 * The client signs `buildChallengeMessage(nonce)` with their secret key;
 * we verify against their public key (wallet address decoded from base32).
 */
const verifyWalletSignature = (
  walletAddress: string,
  signature: string,
  nonce: string,
): boolean => {
  try {
    // Stellar public keys are base32-encoded Ed25519 keys (with version byte + checksum).
    // Strip the 1-byte version prefix (0x30) and 2-byte checksum to get 32-byte raw key.
    const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const padded = walletAddress.toUpperCase().padEnd(
      Math.ceil(walletAddress.length / 8) * 8,
      '=',
    );
    let bits = 0;
    let bitsLen = 0;
    const bytes: number[] = [];
    for (const ch of padded.replace(/=/g, '')) {
      const val = base32Chars.indexOf(ch);
      if (val === -1) return false;
      bits = (bits << 5) | val;
      bitsLen += 5;
      if (bitsLen >= 8) {
        bitsLen -= 8;
        bytes.push((bits >> bitsLen) & 0xff);
      }
    }
    // bytes[0]     = version byte (0x30 for G... account keys)
    // bytes[1..32] = raw 32-byte Ed25519 public key
    // bytes[33..34] = 2-byte checksum
    if (bytes.length < 35) return false;
    const rawPublicKey = Buffer.from(bytes.slice(1, 33));

    // Wrap raw 32-byte Ed25519 key in SPKI DER envelope so Node.js can import it
    const spkiDerPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    const spkiDer = Buffer.concat([spkiDerPrefix, rawPublicKey]);
    const publicKey = createPublicKey({ key: spkiDer, format: 'der', type: 'spki' });

    const message = Buffer.from(buildChallengeMessage(nonce), 'utf8');
    const sigBuf = Buffer.from(signature, 'base64');

    const verify = createVerify('Ed25519');
    verify.update(message);
    return verify.verify(publicKey, sigBuf);
  } catch {
    return false;
  }
};

/** POST /auth/nonce handler — issues a challenge nonce for a wallet address. */
export const handleNonce = async (req: Request, res: Response): Promise<void> => {
  const { walletAddress } = req.body as { walletAddress?: unknown };

  if (typeof walletAddress !== 'string' || !/^G[A-Z2-7]{55}$/.test(walletAddress)) {
    res.status(400).json({
      error: 'Bad Request',
      message: 'walletAddress must be a valid Stellar public key',
      requestId: req.requestId,
    });
    return;
  }

  const nonce = await issueNonce(walletAddress);
  logger.info(req, 'Nonce issued', { walletAddress });

  res.json({
    walletAddress,
    nonce,
    message: buildChallengeMessage(nonce),
    expiresInSeconds: NONCE_TTL_SECONDS,
  });
};

/** POST /auth/verify handler — verifies signature and returns a JWT. */
export const handleVerify = async (req: Request, res: Response): Promise<void> => {
  const { walletAddress, signature } = req.body as {
    walletAddress?: unknown;
    signature?: unknown;
  };

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

  const valid = verifyWalletSignature(walletAddress, signature, nonce);
  if (!valid) {
    logger.warn(req, 'Invalid wallet signature', { walletAddress });
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Signature verification failed.',
      requestId: req.requestId,
    });
    return;
  }

  const token = signJwt({ sub: walletAddress });
  logger.info(req, 'Wallet authenticated', { walletAddress });

  res.json({ token });
};

/** Express middleware — require a valid JWT in Authorization: Bearer <token>. */
export const requireAuth = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
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
  const payload = verifyJwt(token);
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

/** Middleware — verify the authenticated wallet is the admin of :orgId. */
export const requireOrgAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const { prisma } = await import('../lib/prisma');
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
    logger.warn(req, 'Cross-org access denied', {
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

/** Middleware — verify the authenticated wallet belongs to :orgId (as admin or member). */
export const requireOrgMember = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const { prisma } = await import('../lib/prisma');
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
  const wallet = req.walletAddress!;
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
      logger.warn(req, 'Cross-org access denied (member check)', {
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
