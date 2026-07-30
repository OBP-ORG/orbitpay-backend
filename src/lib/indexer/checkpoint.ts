import { prisma } from '../prisma';
import { getRedisClient } from '../redis';

const CHECKPOINT_KEY = 'orbitpay:indexer:checkpoint';
const CURSOR_KEY = 'orbitpay:indexer:cursor';

export const getCheckpoint = async (): Promise<number | null> => {
  const state = await prisma.indexerState.findUnique({
    where: { id: 'singleton' }
  });
  return state ? state.lastLedger : null;
};

export const getCursor = async (): Promise<string | null> => {
  const redis = await getRedisClient();
  return await redis.get(CURSOR_KEY);
};

export const setCursor = async (cursor: string): Promise<void> => {
  const redis = await getRedisClient();
  await redis.set(CURSOR_KEY, cursor);
};
