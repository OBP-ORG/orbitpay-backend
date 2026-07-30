import { rpc as SorobanRpc } from '@stellar/stellar-sdk';
import { Prisma, PrismaClient } from '@prisma/client';
import { config } from '../../config';
import { prisma } from '../prisma';
import { getCheckpoint, getCursor, setCursor } from './checkpoint';
import { decodeEventData, DecodedEvent } from './decoder';
import { getRedisClient } from '../redis';
import {
  registry,
  observedLedger,
  indexedLedger,
  lagSeconds,
  failuresTotal,
  retriesTotal,
  eventsProcessed,
  decodeFailures,
} from './metrics';

type IndexerState = {
  lastPollAt: string | null;
  lastSuccessfulPollAt: string | null;
  lastError: string | null;
  currentLedger: number | null;
};

const state: IndexerState = {
  lastPollAt: null,
  lastSuccessfulPollAt: null,
  lastError: null,
  currentLedger: null,
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const getContractFilters = (): SorobanRpc.Api.EventFilter[] => {
  return config.contractIds.map((contractId) => ({
    type: 'contract' as const,
    contractIds: [contractId],
    topics: [['*']],
  }));
};

const extractAddress = (data: Record<string, unknown>): string | null => {
  const fields = [
    'depositor', 'proposer', 'signer', 'recipient', 'admin',
    'new_signer', 'removed_signer', 'caller', 'sender',
    'grantor', 'beneficiary', 'voter', 'from', 'to',
  ];
  for (const field of fields) {
    if (typeof data[field] === 'string') return data[field] as string;
  }
  return null;
};

const extractAmount = (data: Record<string, unknown>): bigint | null => {
  const fields = ['amount', 'earned', 'total_paid', 'cliff_amount'];
  for (const field of fields) {
    const val = data[field];
    if (typeof val === 'bigint') return val;
    if (typeof val === 'number' && Number.isSafeInteger(val)) return BigInt(val);
    if (typeof val === 'string' && /^-?\d+$/.test(val.trim())) return BigInt(val.trim());
  }
  return null;
};

const extractProposalId = (data: Record<string, unknown>): bigint | null => {
  const val = data.proposal_id ?? data.proposalId;
  if (typeof val === 'bigint') return val;
  if (typeof val === 'number' && Number.isSafeInteger(val)) return BigInt(val);
  if (typeof val === 'string' && /^-?\d+$/.test(val.trim())) return BigInt(val.trim());
  return null;
};

const extractStreamId = (data: Record<string, unknown>): bigint | null => {
  const val = data.stream_id ?? data.streamId;
  if (typeof val === 'bigint') return val;
  if (typeof val === 'number' && Number.isSafeInteger(val)) return BigInt(val);
  if (typeof val === 'string' && /^-?\d+$/.test(val.trim())) return BigInt(val.trim());
  return null;
};

type TxPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

class QuarantineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuarantineError';
  }
}

const upsertEvent = async (
  event: DecodedEvent,
  tx: TxPrisma = prisma,
): Promise<void> => {
  const data = event.data;

  if (event.contractId === config.contracts.treasury) {
    const rawAmount = extractAmount(data);
    const rawProposalId = extractProposalId(data);
    await tx.treasuryEvent.upsert({
      where: { eventId: event.eventId },
      create: {
        eventId: event.eventId,
        treasuryAddress: event.contractId,
        eventType: event.topic,
        address: extractAddress(data),
        amount: rawAmount !== null ? Number(rawAmount) : null,
        token: typeof data.token === 'string' ? data.token : null,
        txHash: event.txHash,
        proposalId: rawProposalId !== null ? Number(rawProposalId) : null,
        metadata: data as Prisma.InputJsonValue,
      },
      update: { metadata: data as Prisma.InputJsonValue },
    });
    eventsProcessed.inc({ contract: 'treasury' });
    return;
  }

  if (event.contractId === config.contracts.payrollStream) {
    const streamId = extractStreamId(data);
    if (streamId === null && event.topic === 'StreamCreated') {
      throw new QuarantineError('StreamCreated event missing stream_id');
    }

    if (['StreamCreated', 'StreamClaimed', 'StreamCancelled', 'StreamPaused', 'StreamResumed'].includes(event.topic)) {
      const sid = Number(streamId ?? 0);
      const statusMap: Record<string, string> = {
        StreamCreated: 'active',
        StreamCancelled: 'cancelled',
        StreamPaused: 'paused',
        StreamResumed: 'active',
        StreamClaimed: 'active',
      };

      await tx.stream.upsert({
        where: { contractStreamId: sid },
        create: {
          contractStreamId: sid,
          sender: typeof data.sender === 'string' ? data.sender : '',
          recipient: typeof data.recipient === 'string' ? data.recipient : '',
          token: typeof data.token === 'string' ? data.token : '',
          totalAmount: Number(extractAmount(data) ?? 0),
          startTime: new Date(),
          endTime: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          status: statusMap[event.topic] ?? 'active',
        },
        update: {
          status: statusMap[event.topic],
          ...(event.topic === 'StreamClaimed' && {
            claimedAmount: { increment: Number(extractAmount(data) ?? 0) },
          }),
        },
      });

      if (event.topic === 'StreamClaimed') {
        const existing = await tx.stream.findUnique({
          where: { contractStreamId: sid },
        });
        if (existing) {
          await tx.claimEvent.upsert({
            where: {
              streamId_txHash: {
                streamId: existing.id,
                txHash: event.txHash,
              },
            },
            create: {
              streamId: existing.id,
              amount: Number(extractAmount(data) ?? 0),
              txHash: event.txHash,
            },
            update: {
              amount: Number(extractAmount(data) ?? 0),
            },
          });
        }
      }
    }
    eventsProcessed.inc({ contract: 'payroll' });
    return;
  }

  if (event.contractId === config.contracts.vesting) {
    const scheduleId = `v-${data.schedule_id ?? data.scheduleId ?? event.eventId}`;
    const statusMap: Record<string, string> = {
      VestingCreated: 'active',
      VestingClaimed: 'active',
      VestingRevoked: 'revoked',
      VestingFullyClaimed: 'completed',
    };

    await tx.vestingSchedule.upsert({
      where: { id: scheduleId },
      create: {
        id: scheduleId,
        grantor: typeof data.grantor === 'string' ? data.grantor : '',
        beneficiary: typeof data.beneficiary === 'string' ? data.beneficiary : '',
        amount: Number(extractAmount(data) ?? 0),
        status: statusMap[event.topic] ?? 'active',
        startTime: new Date(),
        endTime: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
      update: { status: statusMap[event.topic] },
    });
    eventsProcessed.inc({ contract: 'vesting' });
    return;
  }

  if (event.contractId === config.contracts.governance) {
    const proposalId = `p-${data.proposal_id ?? data.proposalId ?? event.eventId}`;
    const statusMap: Record<string, string> = {
      ProposalCreated: 'active',
      VoteCast: 'active',
      ProposalFinalized: 'approved',
      ProposalExecuted: 'executed',
      ProposalCancelled: 'cancelled',
    };

    await tx.proposal.upsert({
      where: { id: proposalId },
      create: {
        id: proposalId,
        proposer: typeof data.proposer === 'string' ? data.proposer : '',
        title: typeof data.title === 'string' ? data.title : '',
        amount: Number(extractAmount(data) ?? 0),
        status: statusMap[event.topic] ?? 'active',
      },
      update: { status: statusMap[event.topic] },
    });

    if (event.topic === 'VoteCast') {
      const voterAddr = typeof data.voter === 'string' ? data.voter : '';
      const voteWeight = typeof data.weight === 'number' ? data.weight : 1;
      await tx.vote.upsert({
        where: { proposalId_voter: { proposalId, voter: voterAddr } },
        create: {
          proposalId,
          voter: voterAddr,
          support: data.choice === 'For' || data.support === true || data.support === 'true',
          weight: voteWeight,
        },
        update: {
          support: data.choice === 'For' || data.support === true || data.support === 'true',
          weight: voteWeight,
        },
      });
    }
    eventsProcessed.inc({ contract: 'governance' });
    return;
  }

  throw new QuarantineError(
    `unknown contract ${event.contractId} — not in configured contract registry`,
  );
  eventsProcessed.inc({ contract: 'unknown' });
};

const quarantineEvent = async (
  event: DecodedEvent,
  error: string,
  tx: TxPrisma = prisma,
): Promise<void> => {
  await tx.deadLetterEvent.create({
    data: {
      eventId: event.eventId,
      ledger: event.ledger,
      txHash: event.txHash,
      contractId: event.contractId,
      topic: event.topic,
      rawData: event.data as Prisma.InputJsonValue,
      error,
    },
  });
};

type ProcessResult = {
  processed: number;
  quarantined: number;
  quarantinedLedgers: Set<number>;
  maxAppliedLedger: number;
};

const processEventsInTransaction = async (
  events: DecodedEvent[],
  startLedger?: number,
): Promise<ProcessResult> => {
  const quarantinedLedgers = new Set<number>();
  const redis = await getRedisClient();

  const result = await prisma.$transaction(async (tx) => {
    let processed = 0;
    let quarantined = 0;

    for (const event of events) {
      try {
        const isProcessed = await redis.sIsMember('orbitpay:indexer:processed_events', event.eventId);
        if (isProcessed) {
          continue;
        }
        await upsertEvent(event, tx);
        await redis.sAdd('orbitpay:indexer:processed_events', event.eventId);
        await redis.expire('orbitpay:indexer:processed_events', 7 * 24 * 60 * 60); // 7 days TTL
        processed++;
      } catch (error) {
        decodeFailures.inc({ contract: event.contractId });
        if (error instanceof QuarantineError) {
          await quarantineEvent(event, error.message, tx);
        } else {
          await quarantineEvent(
            event,
            error instanceof Error ? error.message : 'Unknown error',
            tx,
          );
        }
        quarantinedLedgers.add(event.ledger);
        quarantined++;
      }
    }

    const appliedEvents = events.filter((e) => !quarantinedLedgers.has(e.ledger));
    const maxAppliedLedger = appliedEvents.length > 0
      ? Math.max(...appliedEvents.map((e) => e.ledger))
      : (events.length > 0 ? Math.min(...events.map((e) => e.ledger)) : (startLedger ?? 0));

    if (maxAppliedLedger) {
      await tx.indexerState.upsert({
        where: { id: 'singleton' },
        create: { id: 'singleton', lastLedger: maxAppliedLedger },
        update: { lastLedger: maxAppliedLedger }
      });
    }

    return { processed, quarantined, maxAppliedLedger };
  });

  return { ...result, quarantinedLedgers };
};

export const createIndexerEngine = () => {
  const rpc = new SorobanRpc.Server(config.stellar.rpcUrl);

  const poll = async (): Promise<void> => {
    state.lastPollAt = new Date().toISOString();

    let lastErrorMsg: string | null = null;

    for (let attempt = 0; attempt < config.indexer.maxRetries; attempt++) {
      if (attempt > 0) {
        retriesTotal.inc();
        const delay = config.indexer.retryBaseMs * 2 ** (attempt - 1);
        await sleep(delay);
      }

      try {
        const cursor = await getCursor();
        let requestPayload: any = {
          filters: getContractFilters(),
          limit: config.indexer.batchSize,
        };

        let startLedger: number | undefined;
        if (cursor) {
          requestPayload.cursor = cursor;
        } else {
          const checkpoint = await getCheckpoint();
          startLedger = checkpoint
            ? checkpoint + 1
            : config.indexer.startLedger > 0
              ? config.indexer.startLedger
              : undefined;
              
          if (startLedger) {
            requestPayload.startLedger = startLedger;
          }
        }

        const response = await rpc.getEvents(requestPayload);

        const latestLedger = response.latestLedger;
        observedLedger.set(latestLedger);

        const events: DecodedEvent[] = [];
        for (const rawEvent of response.events) {
          const decoded = decodeEventData(rawEvent as SorobanRpc.Api.EventResponse & Record<string, unknown>);
          if (decoded) {
            events.push(decoded);
          }
        }

        if (events.length > 0) {
          const { processed, quarantined, maxAppliedLedger } =
            await processEventsInTransaction(events, startLedger);

          indexedLedger.set(maxAppliedLedger);

          if (maxAppliedLedger) {
            const lag = Math.max(0, (latestLedger - maxAppliedLedger) * 5);
            lagSeconds.set(lag);
          }

          state.currentLedger = maxAppliedLedger;

          console.log(
            `Indexed ledger ${startLedger ?? 'latest'}: ${processed} events, ${quarantined} quarantined`,
          );
        } else if (startLedger !== undefined) {
          await prisma.indexerState.upsert({
            where: { id: 'singleton' },
            create: { id: 'singleton', lastLedger: startLedger },
            update: { lastLedger: startLedger }
          });
          indexedLedger.set(startLedger);

          if (startLedger) {
            const lag = Math.max(0, (latestLedger - startLedger) * 5);
            lagSeconds.set(lag);
          }

          state.currentLedger = startLedger;
        } else {
          await prisma.indexerState.upsert({
            where: { id: 'singleton' },
            create: { id: 'singleton', lastLedger: latestLedger },
            update: { lastLedger: latestLedger }
          });
          indexedLedger.set(latestLedger);

          if (latestLedger) {
            const lag = 0;
            lagSeconds.set(lag);
          }

          state.currentLedger = latestLedger;
        }

        const cursorRes = response as SorobanRpc.Api.GetEventsResponse & { cursor?: string };
        if (cursorRes.cursor) {
          await setCursor(cursorRes.cursor);
        }
        state.lastSuccessfulPollAt = new Date().toISOString();
        state.lastError = null;
        return;
      } catch (error) {
        lastErrorMsg =
          error instanceof Error ? error.message : 'Unknown indexer error';
      }
    }

    failuresTotal.inc();
    state.lastError = lastErrorMsg;
    console.error('Indexer poll failed after retries:', lastErrorMsg);
  };

  let pollInterval: ReturnType<typeof setInterval> | null = null;

  const start = (): void => {
    pollInterval = setInterval(() => {
      void poll();
    }, config.indexer.pollIntervalMs);
    void poll();
  };

  const stop = (): void => {
    if (pollInterval !== null) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  };

  const getMetrics = async (): Promise<string> => {
    return registry.metrics();
  };

  return { start, stop, poll, getMetrics, getState: () => ({ ...state }) };
};
