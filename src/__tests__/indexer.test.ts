import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { createIndexerEngine } from '../lib/indexer/engine';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Indexer Engine Tests', () => {
  let mockEvents: any[] = [];
  let mockLatestLedger = 500;
  let mockCheckpointValue: number | null = null;
  let checkpointUpsertedValue: number | null = null;

  let dbUpserts: any[] = [];
  let dlEvents: any[] = [];

  const mockTx: any = {
    treasuryEvent: {
      upsert: async (args: any) => {
        dbUpserts.push({ type: 'treasury', ...args });
      },
    },
    stream: {
      upsert: async (args: any) => {
        dbUpserts.push({ type: 'stream', ...args });
      },
      findUnique: async () => ({ id: 'stream-uuid-123' }),
    },
    claimEvent: {
      upsert: async (args: any) => {
        dbUpserts.push({ type: 'claim', ...args });
      },
    },
    vestingSchedule: {
      upsert: async (args: any) => {
        dbUpserts.push({ type: 'vesting', ...args });
      },
    },
    proposal: {
      upsert: async (args: any) => {
        dbUpserts.push({ type: 'proposal', ...args });
      },
    },
    vote: {
      upsert: async (args: any) => {
        dbUpserts.push({ type: 'vote', ...args });
      },
    },
    deadLetterEvent: {
      create: async (args: any) => {
        dlEvents.push(args.data);
      },
    },
    checkpoint: {
      upsert: async (args: any) => {
        checkpointUpsertedValue = args.create.value;
      },
      findUnique: async () => {
        return mockCheckpointValue !== null ? { value: mockCheckpointValue } : null;
      },
    },
  };

  beforeEach(() => {
    mockEvents = [];
    mockLatestLedger = 500;
    mockCheckpointValue = null;
    checkpointUpsertedValue = null;
    dbUpserts = [];
    dlEvents = [];

    // Reset mockTx methods to default success behaviors
    mockTx.checkpoint.upsert = async (args: any) => {
      checkpointUpsertedValue = args.create.value;
    };
    mockTx.stream.findUnique = async () => ({ id: 'stream-uuid-123' });

    // Mock Prisma Client
    prisma.$transaction = async (callback: any) => {
      return callback(mockTx);
    };

    prisma.checkpoint = {
      findUnique: async () => {
        return mockCheckpointValue !== null ? { value: mockCheckpointValue } : null;
      },
      upsert: async (args: any) => {
        checkpointUpsertedValue = args.create.value;
        return {} as any;
      },
    } as any;

    // Mock Soroban RPC Server prototype
    SorobanRpc.Server.prototype.getEvents = async (args: any) => {
      return {
        events: mockEvents,
        latestLedger: mockLatestLedger,
        cursor: 'mock-cursor',
        oldestLedger: 1,
        latestLedgerCloseTime: '2026-07-19T12:00:00Z',
        oldestLedgerCloseTime: '2026-07-19T12:00:00Z',
      } as any;
    };

    // Override config parameters for testing
    config.indexer.maxRetries = 3;
    config.indexer.retryBaseMs = 2; // small delay to prevent test lag
    config.indexer.pollIntervalMs = 10000; // set high so it doesn't poll repeatedly in tests
    config.contracts.payrollStream = 'CB_PAYROLL_STREAM';
  });

  const runSinglePoll = async (engine: any) => {
    const initialState = { ...engine.getState() };
    engine.start();
    
    // Wait until the poll completed (either got a success timestamp or an error)
    while (true) {
      const state = engine.getState();
      if (
        state.lastError !== initialState.lastError ||
        state.lastSuccessfulPollAt !== initialState.lastSuccessfulPollAt
      ) {
        break;
      }
      await sleep(2);
    }
    
    engine.stop();
  };

  test('ClaimEvent upsert is idempotent on replay', async () => {
    mockCheckpointValue = 100;
    mockEvents = [
      {
        id: 'ev-101-tx1',
        ledger: 101,
        txHash: 'txhash123',
        contractId: 'CB_PAYROLL_STREAM',
        topic: 'StreamClaimed',
        value: {
          _type: 'map',
          value: [], // mock raw data
        },
      },
    ];

    const engine = createIndexerEngine();
    await runSinglePoll(engine);

    // Verify claimEvent was upserted using the transaction hash
    const claimUpsert = dbUpserts.find((u) => u.type === 'claim');
    assert.ok(claimUpsert, 'Claim event upsert should be called');
    assert.strictEqual(claimUpsert.where.txHash, 'txhash123');
    assert.strictEqual(checkpointUpsertedValue, 101, 'Checkpoint should advance to 101');
  });

  test('Atomic rollback on transaction failure', async () => {
    mockCheckpointValue = 100;
    mockEvents = [
      {
        id: 'ev-101-tx1',
        ledger: 101,
        txHash: 'txhash1',
        contractId: 'CB_PAYROLL_STREAM',
        topic: 'StreamClaimed',
      },
    ];

    // Make setCheckpoint throw a database error
    mockTx.checkpoint.upsert = async () => {
      throw new Error('Database connection lost');
    };

    const engine = createIndexerEngine();
    await runSinglePoll(engine);

    // The transaction should rollback and fail all attempts.
    // Checkpoint should NOT have been updated.
    assert.strictEqual(checkpointUpsertedValue, null, 'Checkpoint should not be updated on transaction failure');
  });

  test('Failed event is quarantined and checkpoint advanced on final attempt', async () => {
    mockCheckpointValue = 100;
    mockEvents = [
      {
        id: 'ev-101-tx1',
        ledger: 101,
        txHash: 'txhash1',
        contractId: 'CB_PAYROLL_STREAM',
        topic: 'StreamClaimed',
      },
    ];

    // Force error on all attempts
    mockTx.stream.findUnique = async () => {
      throw new Error('Persistent serialization error');
    };

    // Set maxRetries to 1 so the first attempt is also the final attempt
    config.indexer.maxRetries = 1;

    const engine = createIndexerEngine();
    await runSinglePoll(engine);

    // On the final attempt, the error should be caught and quarantined,
    // and the checkpoint should advance.
    assert.strictEqual(dlEvents.length, 1, 'Failed event should be quarantined');
    assert.strictEqual(dlEvents[0].error, 'Persistent serialization error');
    assert.strictEqual(checkpointUpsertedValue, 101, 'Checkpoint should advance on quarantine');
  });

  test('Empty page handling bounds checkpoint advancement to endLedger', async () => {
    // Scenario 1: startLedger is 100, latestLedger is 500. endLedger should be 500.
    mockCheckpointValue = 100;
    mockLatestLedger = 500;
    mockEvents = [];

    let engine = createIndexerEngine();
    await runSinglePoll(engine);
    assert.strictEqual(checkpointUpsertedValue, 500, 'Checkpoint should advance to latestLedger if startLedger + 10000 > latestLedger');

    // Scenario 2: startLedger is 100, latestLedger is 20000. endLedger should be 10101 (startLedger + 10000).
    mockCheckpointValue = 100;
    mockLatestLedger = 20000;
    checkpointUpsertedValue = null;

    engine = createIndexerEngine();
    await runSinglePoll(engine);
    assert.strictEqual(checkpointUpsertedValue, 10101, 'Checkpoint should be bounded by startLedger + 10000');
  });
});
