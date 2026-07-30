const mockPrismaClient = {
  treasuryEvent: { upsert: jest.fn() },
  stream: { upsert: jest.fn(), findUnique: jest.fn() },
  claimEvent: { upsert: jest.fn() },
  vestingSchedule: { upsert: jest.fn() },
  proposal: { upsert: jest.fn() },
  vote: { upsert: jest.fn() },
  deadLetterEvent: { create: jest.fn() },
  indexerState: { upsert: jest.fn(), findUnique: jest.fn() },
  $transaction: jest.fn(),
};

jest.mock('../lib/prisma', () => ({
  get prisma() { return mockPrismaClient; },
}));

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  sIsMember: jest.fn(),
  sAdd: jest.fn(),
  expire: jest.fn(),
};

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
import { decodeEventData } from '../lib/indexer/decoder';

jest.mock('../lib/indexer/decoder', () => ({
  decodeEventData: jest.fn(),
}));
const mockDecodeEventData = decodeEventData as jest.Mock;

describe('Indexer engine cursor-aware pagination and idempotency', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.sIsMember.mockResolvedValue(false);
    mockRedis.sAdd.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);
    
    mockRpcGetEvents.mockResolvedValue({
      latestLedger: 200,
      events: [],
    });
    mockPrismaClient.$transaction.mockImplementation(async (fn: Function) => {
      return fn(mockPrismaClient);
    });
    mockPrismaClient.indexerState.findUnique.mockResolvedValue(null);
    mockPrismaClient.indexerState.upsert.mockResolvedValue({});
  });

  describe('cursor-aware pagination', () => {
    it('passes cursor to rpc.getEvents when cursor exists in redis', async () => {
      mockRedis.get.mockResolvedValueOnce('cursor-xyz-123');
      
      const engine = createIndexerEngine();
      await engine.poll();
      
      expect(mockRpcGetEvents).toHaveBeenCalledWith(expect.objectContaining({
        cursor: 'cursor-xyz-123',
      }));
    });

    it('saves new cursor to redis when response contains a cursor', async () => {
      mockRpcGetEvents.mockResolvedValueOnce({
        latestLedger: 200,
        events: [],
        cursor: 'cursor-abc-456'
      });
      
      const engine = createIndexerEngine();
      await engine.poll();
      
      expect(mockRedis.set).toHaveBeenCalledWith(
        'orbitpay:indexer:cursor',
        'cursor-abc-456'
      );
    });
  });

  describe('event-level idempotency via Redis', () => {
    it('skips already processed events and does not write to DB', async () => {
      mockRpcGetEvents.mockResolvedValueOnce({
        latestLedger: 200,
        events: [{ type: 'contract', ledger: 100 }],
        cursor: 'cursor-abc-456'
      });
      mockDecodeEventData.mockReturnValueOnce({
        eventId: 'ev-1',
        ledger: 100,
        txHash: 'tx-1',
        contractId: 'C_treasury',
        topic: 'Deposit',
        data: { amount: 100 }
      });

      // Mock redis saying the event is already processed
      mockRedis.sIsMember.mockResolvedValueOnce(true);

      const engine = createIndexerEngine();
      await engine.poll();
      
      expect(mockRedis.sIsMember).toHaveBeenCalledWith('orbitpay:indexer:processed_events', 'ev-1');
      expect(mockPrismaClient.treasuryEvent.upsert).not.toHaveBeenCalled();
      expect(mockRedis.sAdd).not.toHaveBeenCalled();
    });

    it('processes new events and adds them to redis processed_events set', async () => {
      mockRpcGetEvents.mockResolvedValueOnce({
        latestLedger: 200,
        events: [{ type: 'contract', ledger: 100 }],
        cursor: 'cursor-abc-456'
      });
      mockDecodeEventData.mockReturnValueOnce({
        eventId: 'ev-2',
        ledger: 100,
        txHash: 'tx-1',
        contractId: 'C_treasury',
        topic: 'Deposit',
        data: { amount: 100 }
      });

      // Mock redis saying the event is NOT processed
      mockRedis.sIsMember.mockResolvedValueOnce(false);

      const engine = createIndexerEngine();
      await engine.poll();
      
      expect(mockPrismaClient.treasuryEvent.upsert).toHaveBeenCalled();
      expect(mockRedis.sAdd).toHaveBeenCalledWith('orbitpay:indexer:processed_events', 'ev-2');
      expect(mockRedis.expire).toHaveBeenCalledWith('orbitpay:indexer:processed_events', 7 * 24 * 60 * 60);
    });
  });

  describe('crash recovery and Prisma checkpointing', () => {
    it('updates Prisma indexerState with maxAppliedLedger', async () => {
      mockRpcGetEvents.mockResolvedValueOnce({
        latestLedger: 200,
        events: [{ type: 'contract', ledger: 100 }, { type: 'contract', ledger: 150 }],
        cursor: 'cursor-xyz'
      });
      mockDecodeEventData
        .mockReturnValueOnce({
          eventId: 'ev-1', ledger: 100, txHash: 'tx-1', contractId: 'C_treasury', topic: 'Deposit', data: {}
        })
        .mockReturnValueOnce({
          eventId: 'ev-2', ledger: 150, txHash: 'tx-2', contractId: 'C_treasury', topic: 'Deposit', data: {}
        });

      const engine = createIndexerEngine();
      await engine.poll();

      expect(mockPrismaClient.indexerState.upsert).toHaveBeenCalledWith({
        where: { id: 'singleton' },
        create: { id: 'singleton', lastLedger: 150 },
        update: { lastLedger: 150 }
      });
    });
  });

  describe('multiple events per transaction', () => {
    it('processes multiple events with the same txHash but distinct eventIds', async () => {
      mockRpcGetEvents.mockResolvedValueOnce({
        latestLedger: 200,
        events: [
          { type: 'contract', ledger: 100 },
          { type: 'contract', ledger: 100 }
        ],
        cursor: 'cursor-end'
      });
      
      // Two distinct events from the same transaction
      mockDecodeEventData
        .mockReturnValueOnce({
          eventId: 'ev-tx1-a', ledger: 100, txHash: 'tx-multi', contractId: 'C_treasury', topic: 'Deposit', data: { amount: 10 }
        })
        .mockReturnValueOnce({
          eventId: 'ev-tx1-b', ledger: 100, txHash: 'tx-multi', contractId: 'C_treasury', topic: 'Deposit', data: { amount: 20 }
        });

      const engine = createIndexerEngine();
      await engine.poll();

      // Upsert called twice for TreasuryEvent, based on eventId now (not txHash)
      expect(mockPrismaClient.treasuryEvent.upsert).toHaveBeenCalledTimes(2);
      expect(mockPrismaClient.treasuryEvent.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { eventId: 'ev-tx1-a' } })
      );
      expect(mockPrismaClient.treasuryEvent.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { eventId: 'ev-tx1-b' } })
      );
    });
  });
});
