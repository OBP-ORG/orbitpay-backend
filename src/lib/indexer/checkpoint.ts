import { getRedisClient } from '../redis';

const CHECKPOINT_KEY = 'orbitpay:indexer:checkpoint';

export const getCheckpoint = async (): Promise<number | null> => {
  const redis = await getRedisClient();
  const value = await redis.get(CHECKPOINT_KEY);
  return value ? Number(value) : null;
};

export const setCheckpoint = async (ledger: number): Promise<void> => {
  const redis = await getRedisClient();
  await redis.set(CHECKPOINT_KEY, String(ledger));
};
