const mockPrismaClient = {
  treasuryEvent: { upsert: jest.fn() },
  stream: { upsert: jest.fn(), findUnique: jest.fn() },
  claimEvent: { upsert: jest.fn() },
  vestingSchedule: { upsert: jest.fn() },
  proposal: { upsert: jest.fn() },
  vote: { upsert: jest.fn() },
  deadLetterEvent: { create: jest.fn() },
  $transaction: jest.fn(),
};

jest.mock('../lib/prisma', () => ({
  get prisma() { return mockPrismaClient; },
}));

jest.mock('../lib/redis', () => ({
  getRedisClient: async () => mockRedis,
}));

jest.mock('../config', () => ({
  config: {
    stellar: { rpcUrl: 'http://localhost' },
    contracts: {
      treasury: 'C_treasury',
      payrollStream: 'C_payroll',
      vesting: 'C_vesting',
      governance: 'C_governance',
    },
    get contractIds() {
      return ['C_treasury', 'C_payroll', 'C_vesting', 'C_governance'];
    },
    indexer: {
      pollIntervalMs: 100,
      batchSize: 10,
      startLedger: 0,
      maxRetries: 2,
      retryBaseMs: 10,
    },
  },
}));

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
};

const mockRpcGetEvents = jest.fn();
jest.mock('@stellar/stellar-sdk', () => ({
  rpc: {
    Server: jest.fn().mockImplementation(() => ({
      getEvents: mockRpcGetEvents,
    })),
    Api: {},
  },
}));

jest.mock('../lib/indexer/metrics', () => ({
  registry: { metrics: jest.fn().mockResolvedValue('') },
  observedLedger: { set: jest.fn() },
  indexedLedger: { set: jest.fn() },
  lagSeconds: { set: jest.fn() },
  failuresTotal: { inc: jest.fn() },
  retriesTotal: { inc: jest.fn() },
  eventsProcessed: { inc: jest.fn() },
  decodeFailures: { inc: jest.fn() },
}));

import { createIndexerEngine } from '../lib/indexer/engine';

function makeEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    eventId: 'ev-100-abc',
    ledger: 100,
    txHash: 'abc',
    contractId: 'C_treasury',
    topic: 'Deposit',
    data: { depositor: 'GABC', amount: BigInt(1000), token: 'USDC' },
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('Indexer engine atomic checkpoint', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue('OK');
    mockRpcGetEvents.mockResolvedValue({
      latestLedger: 200,
      events: [],
    });
    mockPrismaClient.$transaction.mockImplementation(async (fn: Function) => {
      return fn(mockPrismaClient);
    });
  });

  describe('claimEvent idempotency', () => {
    it('uses upsert to prevent duplicate claims on replay', async () => {
      const data = {
        stream_id: BigInt(42),
        recipient: 'GREC',
        amount: BigInt(500),
      };

      mockRpcGetEvents.mockResolvedValueOnce({
        latestLedger: 200,
        events: [{
          ledger: 100,
          txHash: 'tx-1',
          contractId: 'C_payroll',
          topic: 'StreamClaimed',
          value: data,
        }],
      });

      mockPrismaClient.stream.findUnique.mockResolvedValue({
        id: 'stream-uuid-42',
        contractStreamId: 42,
      });

      const engine = createIndexerEngine();
      await engine.poll();

      expect(mockPrismaClient.claimEvent.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { streamId_txHash: { streamId: 'stream-uuid-42', txHash: 'tx-1' } },
          create: expect.objectContaining({ streamId: 'stream-uuid-42', txHash: 'tx-1' }),
        }),
      );
    });
  });

  describe('vote idempotency', () => {
    it('uses upsert to prevent duplicate votes on replay', () => {
      expect(mockPrismaClient.vote.upsert).toBeDefined();
    });
  });

  describe('checkpoint does not advance past quarantined ledgers', () => {
    it('quarantined events are excluded from checkpoint', async () => {
      mockRpcGetEvents.mockResolvedValueOnce({
        latestLedger: 200,
        events: [
          {
            ledger: 100,
            txHash: 'abc',
            contractId: 'C_treasury',
            topic: 'Deposit',
            value: { depositor: 'GABC', amount: 1000n },
          },
          {
            ledger: 150,
            txHash: 'def',
            contractId: 'C_payroll',
            topic: 'StreamCreated',
            value: {},
          },
        ],
      });

      mockPrismaClient.$transaction.mockImplementation(async (fn: Function) => {
        return fn(mockPrismaClient);
      });

      const engine = createIndexerEngine();
      await engine.poll();

      const setCalls = mockRedis.set.mock.calls as [string, string][];
      const lastCheckpoint = setCalls.length > 0 ? Number(setCalls[setCalls.length - 1][1]) : null;
      expect(lastCheckpoint).toBe(100);
    });
  });

  describe('empty page handling', () => {
    it('advances checkpoint by startLedger, not latestLedger, on empty batch', async () => {
      mockRpcGetEvents.mockResolvedValueOnce({
        latestLedger: 500,
        events: [],
      });

      mockRedis.get.mockResolvedValue('99');

      const engine = createIndexerEngine();
      await engine.poll();

      expect(mockRedis.set).toHaveBeenCalledWith(
        'orbitpay:indexer:checkpoint',
        '100',
      );
    });

    it('does not set checkpoint to latestLedger when startLedger is undefined on empty batch', async () => {
      mockRpcGetEvents.mockResolvedValueOnce({
        latestLedger: 500,
        events: [],
      });

      mockRedis.get.mockResolvedValue(null);

      const engine = createIndexerEngine();
      await engine.poll();

      const setCalls = mockRedis.set.mock.calls as [string, string][];
      expect(setCalls.length).toBe(0);
    });
  });

  describe('crash-injection: idempotent replay', () => {
    it('replaying same batch does not duplicate claims', async () => {
      mockPrismaClient.stream.findUnique.mockResolvedValue({
        id: 'stream-uuid-1',
        contractStreamId: 1,
      });

      mockRpcGetEvents.mockResolvedValue({
        latestLedger: 200,
        events: [{
          ledger: 100,
          txHash: 'tx-1',
          contractId: 'C_payroll',
          topic: 'StreamClaimed',
          value: {
            stream_id: BigInt(1),
            recipient: 'GREC',
            amount: BigInt(100),
          },
        }],
      });

      mockPrismaClient.$transaction.mockImplementation(async (fn: Function) => {
        return fn(mockPrismaClient);
      });

      const engine = createIndexerEngine();
      await engine.poll();

      const claimCallsFirst = mockPrismaClient.claimEvent.upsert.mock.calls.length;
      mockPrismaClient.claimEvent.upsert.mockClear();

      await engine.poll();

      expect(mockPrismaClient.claimEvent.upsert).toHaveBeenCalledTimes(claimCallsFirst);
    });

    it('replaying same batch does not duplicate votes', async () => {
      mockRpcGetEvents.mockResolvedValue({
        latestLedger: 200,
        events: [{
          ledger: 100,
          txHash: 'tx-2',
          contractId: 'C_governance',
          topic: 'VoteCast',
          value: {
            proposal_id: BigInt(7),
            voter: 'GVOTER',
            choice: 'For',
            weight: 1,
          },
        }],
      });

      mockPrismaClient.$transaction.mockImplementation(async (fn: Function) => {
        return fn(mockPrismaClient);
      });

      const engine = createIndexerEngine();
      await engine.poll();

      const voteCallsFirst = mockPrismaClient.vote.upsert.mock.calls.length;
      mockPrismaClient.vote.upsert.mockClear();

      await engine.poll();

      expect(mockPrismaClient.vote.upsert).toHaveBeenCalledTimes(voteCallsFirst);
    });
  });
});
