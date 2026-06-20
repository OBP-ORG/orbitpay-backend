import type { Organization } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      walletAddress?: string;
      organization?: Organization;
    }
  }
}
