import { getRedisClient } from '../redis';

const CHECKPOINT_KEY = 'orbitpay:indexer:checkpoint';
const CURSOR_KEY = 'orbitpay:indexer:cursor';

export const getCheckpoint = async (): Promise<number | null> => {
  const redis = await getRedisClient();
  const value = await redis.get(CHECKPOINT_KEY);
  return value ? Number(value) : null;
};

export const setCheckpoint = async (ledger: number): Promise<void> => {
  const redis = await getRedisClient();
  await redis.set(CHECKPOINT_KEY, String(ledger));
};

export const getCursor = async (): Promise<string | null> => {
  const redis = await getRedisClient();
  return await redis.get(CURSOR_KEY);
};

export const setCursor = async (cursor: string): Promise<void> => {
  const redis = await getRedisClient();
  await redis.set(CURSOR_KEY, cursor);
};
