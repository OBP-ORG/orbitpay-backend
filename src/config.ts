import dotenv from 'dotenv';

dotenv.config();

const toNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseContractIds = (value: string | undefined): string[] => {
  if (!value) return [];
  return value
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
};

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: toNumber(process.env.PORT, 3001),
  indexerPort: toNumber(process.env.INDEXER_PORT, 3002),
  databaseUrl: process.env.DATABASE_URL ?? '',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  rateLimit: {
    maxRequests: toNumber(process.env.RATE_LIMIT_MAX_REQUESTS, 100),
    windowMs: toNumber(process.env.RATE_LIMIT_WINDOW_SECONDS, 60) * 1000,
    backoffBaseMs:
      toNumber(process.env.RATE_LIMIT_BACKOFF_BASE_SECONDS, 60) * 1000,
  },
  stellar: {
    rpcUrl: process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org',
    networkPassphrase:
      process.env.STELLAR_NETWORK_PASSPHRASE ??
      'Test SDF Network ; September 2015',
  },
  contracts: {
    treasury: process.env.TREASURY_CONTRACT_ID ?? '',
    payrollStream: process.env.PAYROLL_STREAM_CONTRACT_ID ?? '',
    vesting: process.env.VESTING_CONTRACT_ID ?? '',
    governance: process.env.GOVERNANCE_CONTRACT_ID ?? '',
  },
  indexer: {
    pollIntervalMs: toNumber(process.env.INDEXER_POLL_INTERVAL_MS, 5000),
    batchSize: toNumber(process.env.INDEXER_BATCH_SIZE, 100),
    startLedger: toNumber(process.env.INDEXER_START_LEDGER, 0),
    maxRetries: toNumber(process.env.INDEXER_MAX_RETRIES, 5),
    retryBaseMs: toNumber(process.env.INDEXER_RETRY_BASE_MS, 2000),
    metricsPort: toNumber(process.env.INDEXER_METRICS_PORT, 9090),
  },
  get contractIds(): string[] {
    return [
      this.contracts.treasury,
      this.contracts.payrollStream,
      this.contracts.vesting,
      this.contracts.governance,
    ].filter(Boolean);
  },
};
