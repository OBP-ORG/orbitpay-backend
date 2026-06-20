import { Router } from 'express';
import { handleNonce, handleVerify } from '../middleware/auth';
import { bodyFields } from '../middleware/validate';

const router = Router();

// POST /auth/nonce — issue a challenge nonce for a wallet address
router.post(
  '/nonce',
  bodyFields(['walletAddress']),
  (req, res, next) => {
    handleNonce(req, res).catch(next);
  },
);

// POST /auth/verify — verify wallet signature and issue a JWT
router.post(
  '/verify',
  bodyFields(['walletAddress', 'signature']),
  (req, res, next) => {
    handleVerify(req, res).catch(next);
  },
);

export default router;
