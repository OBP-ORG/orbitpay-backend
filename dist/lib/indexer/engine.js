"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createIndexerEngine = void 0;
const stellar_sdk_1 = require("@stellar/stellar-sdk");
const config_1 = require("../../config");
const prisma_1 = require("../prisma");
const checkpoint_1 = require("./checkpoint");
const decoder_1 = require("./decoder");
const redis_1 = require("../redis");
const metrics_1 = require("./metrics");
const state = {
    lastPollAt: null,
    lastSuccessfulPollAt: null,
    lastError: null,
    currentLedger: null,
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const getContractFilters = () => {
    return config_1.config.contractIds.map((contractId) => ({
        type: 'contract',
        contractIds: [contractId],
        topics: [['*']],
    }));
};
const extractAddress = (data) => {
    const fields = [
        'depositor', 'proposer', 'signer', 'recipient', 'admin',
        'new_signer', 'removed_signer', 'caller', 'sender',
        'grantor', 'beneficiary', 'voter', 'from', 'to',
    ];
    for (const field of fields) {
        if (typeof data[field] === 'string')
            return data[field];
    }
    return null;
};
const extractAmount = (data) => {
    const fields = ['amount', 'earned', 'total_paid', 'cliff_amount'];
    for (const field of fields) {
        const val = data[field];
        if (typeof val === 'bigint')
            return val;
        if (typeof val === 'number' && Number.isSafeInteger(val))
            return BigInt(val);
        if (typeof val === 'string' && /^-?\d+$/.test(val.trim()))
            return BigInt(val.trim());
    }
    return null;
};
const extractProposalId = (data) => {
    const val = data.proposal_id ?? data.proposalId;
    if (typeof val === 'bigint')
        return val;
    if (typeof val === 'number' && Number.isSafeInteger(val))
        return BigInt(val);
    if (typeof val === 'string' && /^-?\d+$/.test(val.trim()))
        return BigInt(val.trim());
    return null;
};
const extractStreamId = (data) => {
    const val = data.stream_id ?? data.streamId;
    if (typeof val === 'bigint')
        return val;
    if (typeof val === 'number' && Number.isSafeInteger(val))
        return BigInt(val);
    if (typeof val === 'string' && /^-?\d+$/.test(val.trim()))
        return BigInt(val.trim());
    return null;
};
class QuarantineError extends Error {
    constructor(message) {
        super(message);
        this.name = 'QuarantineError';
    }
}
const upsertEvent = async (event, tx = prisma_1.prisma) => {
    const data = event.data;
    if (event.contractId === config_1.config.contracts.treasury) {
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
                metadata: data,
            },
            update: { metadata: data },
        });
        metrics_1.eventsProcessed.inc({ contract: 'treasury' });
        return;
    }
    if (event.contractId === config_1.config.contracts.payrollStream) {
        const streamId = extractStreamId(data);
        if (streamId === null && event.topic === 'StreamCreated') {
            throw new QuarantineError('StreamCreated event missing stream_id');
        }
        if (['StreamCreated', 'StreamClaimed', 'StreamCancelled', 'StreamPaused', 'StreamResumed'].includes(event.topic)) {
            const sid = Number(streamId ?? 0);
            const statusMap = {
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
        metrics_1.eventsProcessed.inc({ contract: 'payroll' });
        return;
    }
    if (event.contractId === config_1.config.contracts.vesting) {
        const scheduleId = `v-${data.schedule_id ?? data.scheduleId ?? event.eventId}`;
        const statusMap = {
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
        metrics_1.eventsProcessed.inc({ contract: 'vesting' });
        return;
    }
    if (event.contractId === config_1.config.contracts.governance) {
        const proposalId = `p-${data.proposal_id ?? data.proposalId ?? event.eventId}`;
        const statusMap = {
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
        metrics_1.eventsProcessed.inc({ contract: 'governance' });
        return;
    }
    throw new QuarantineError(`unknown contract ${event.contractId} — not in configured contract registry`);
    metrics_1.eventsProcessed.inc({ contract: 'unknown' });
};
const quarantineEvent = async (event, error, tx = prisma_1.prisma) => {
    await tx.deadLetterEvent.create({
        data: {
            eventId: event.eventId,
            ledger: event.ledger,
            txHash: event.txHash,
            contractId: event.contractId,
            topic: event.topic,
            rawData: event.data,
            error,
        },
    });
};
const processEventsInTransaction = async (events, startLedger) => {
    const quarantinedLedgers = new Set();
    const redis = await (0, redis_1.getRedisClient)();
    const result = await prisma_1.prisma.$transaction(async (tx) => {
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
            }
            catch (error) {
                metrics_1.decodeFailures.inc({ contract: event.contractId });
                if (error instanceof QuarantineError) {
                    await quarantineEvent(event, error.message, tx);
                }
                else {
                    await quarantineEvent(event, error instanceof Error ? error.message : 'Unknown error', tx);
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
const createIndexerEngine = () => {
    const rpc = new stellar_sdk_1.rpc.Server(config_1.config.stellar.rpcUrl);
    const poll = async () => {
        state.lastPollAt = new Date().toISOString();
        let lastErrorMsg = null;
        for (let attempt = 0; attempt < config_1.config.indexer.maxRetries; attempt++) {
            if (attempt > 0) {
                metrics_1.retriesTotal.inc();
                const delay = config_1.config.indexer.retryBaseMs * 2 ** (attempt - 1);
                await sleep(delay);
            }
            try {
                const cursor = await (0, checkpoint_1.getCursor)();
                let requestPayload = {
                    filters: getContractFilters(),
                    limit: config_1.config.indexer.batchSize,
                };
                let startLedger;
                if (cursor) {
                    requestPayload.cursor = cursor;
                }
                else {
                    const checkpoint = await (0, checkpoint_1.getCheckpoint)();
                    startLedger = checkpoint
                        ? checkpoint + 1
                        : config_1.config.indexer.startLedger > 0
                            ? config_1.config.indexer.startLedger
                            : undefined;
                    if (startLedger) {
                        requestPayload.startLedger = startLedger;
                    }
                }
                const response = await rpc.getEvents(requestPayload);
                const latestLedger = response.latestLedger;
                metrics_1.observedLedger.set(latestLedger);
                const events = [];
                for (const rawEvent of response.events) {
                    const decoded = (0, decoder_1.decodeEventData)(rawEvent);
                    if (decoded) {
                        events.push(decoded);
                    }
                }
                if (events.length > 0) {
                    const { processed, quarantined, maxAppliedLedger } = await processEventsInTransaction(events, startLedger);
                    metrics_1.indexedLedger.set(maxAppliedLedger);
                    if (maxAppliedLedger) {
                        const lag = Math.max(0, (latestLedger - maxAppliedLedger) * 5);
                        metrics_1.lagSeconds.set(lag);
                    }
                    state.currentLedger = maxAppliedLedger;
                    console.log(`Indexed ledger ${startLedger ?? 'latest'}: ${processed} events, ${quarantined} quarantined`);
                }
                else if (startLedger !== undefined) {
                    await prisma_1.prisma.indexerState.upsert({
                        where: { id: 'singleton' },
                        create: { id: 'singleton', lastLedger: startLedger },
                        update: { lastLedger: startLedger }
                    });
                    metrics_1.indexedLedger.set(startLedger);
                    if (startLedger) {
                        const lag = Math.max(0, (latestLedger - startLedger) * 5);
                        metrics_1.lagSeconds.set(lag);
                    }
                    state.currentLedger = startLedger;
                }
                else {
                    await prisma_1.prisma.indexerState.upsert({
                        where: { id: 'singleton' },
                        create: { id: 'singleton', lastLedger: latestLedger },
                        update: { lastLedger: latestLedger }
                    });
                    metrics_1.indexedLedger.set(latestLedger);
                    if (latestLedger) {
                        const lag = 0;
                        metrics_1.lagSeconds.set(lag);
                    }
                    state.currentLedger = latestLedger;
                }
                const cursorRes = response;
                if (cursorRes.cursor) {
                    await (0, checkpoint_1.setCursor)(cursorRes.cursor);
                }
                state.lastSuccessfulPollAt = new Date().toISOString();
                state.lastError = null;
                return;
            }
            catch (error) {
                lastErrorMsg =
                    error instanceof Error ? error.message : 'Unknown indexer error';
            }
        }
        metrics_1.failuresTotal.inc();
        state.lastError = lastErrorMsg;
        console.error('Indexer poll failed after retries:', lastErrorMsg);
    };
    let pollInterval = null;
    const start = () => {
        pollInterval = setInterval(() => {
            void poll();
        }, config_1.config.indexer.pollIntervalMs);
        void poll();
    };
    const stop = () => {
        if (pollInterval !== null) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
    };
    const getMetrics = async () => {
        return metrics_1.registry.metrics();
    };
    return { start, stop, poll, getMetrics, getState: () => ({ ...state }) };
};
exports.createIndexerEngine = createIndexerEngine;
