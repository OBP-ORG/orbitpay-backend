import { createClient } from 'redis';
import { config } from '../config';

type OrbitPayRedisClient = ReturnType<typeof createClient>;

let redisClient: OrbitPayRedisClient | null = null;
let redisConnectPromise: Promise<OrbitPayRedisClient> | null = null;

export const getRedisClient = async (): Promise<OrbitPayRedisClient> => {
  if (redisClient?.isOpen) {
    return redisClient;
  }

  if (redisConnectPromise) {
    return redisConnectPromise;
  }

  const client = createClient({
    url: config.redisUrl,
    socket: {
      connectTimeout: config.redisSocketTimeoutMs,
      reconnectStrategy: (retries: number) =>
        Math.min(1000 * 2 ** retries, 10_000),
    },
  });

  client.on('error', (error: unknown) => {
    console.error(JSON.stringify({ level: 'error', msg: 'Redis client error', meta: String(error) }));
  });

  redisConnectPromise = client.connect().then(() => {
    redisClient = client;
    redisConnectPromise = null;
    return client;
  });

  return redisConnectPromise;
};
