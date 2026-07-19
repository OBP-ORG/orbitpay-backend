import { prisma } from '../prisma';
import { Prisma } from '@prisma/client';

const CHECKPOINT_KEY = 'orbitpay:indexer:checkpoint';

export const getCheckpoint = async (
  tx?: Prisma.TransactionClient,
): Promise<number | null> => {
  const client = tx || prisma;
  const checkpoint = await client.checkpoint.findUnique({
    where: { key: CHECKPOINT_KEY },
  });
  return checkpoint ? checkpoint.value : null;
};

export const setCheckpoint = async (
  ledger: number,
  tx?: Prisma.TransactionClient,
): Promise<void> => {
  const client = tx || prisma;
  await client.checkpoint.upsert({
    where: { key: CHECKPOINT_KEY },
    update: { value: ledger },
    create: { key: CHECKPOINT_KEY, value: ledger },
  });
};
