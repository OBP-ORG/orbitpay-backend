import { rpc as SorobanRpc } from '@stellar/stellar-sdk';

export type DecodedEvent = {
  eventId: string;
  ledger: number;
  txHash: string;
  contractId: string;
  topic: string;
  data: Record<string, unknown>;
  timestamp: number;
};

const topicToString = (topic: unknown): string => {
  if (typeof topic === 'string') return topic;
  if (typeof topic === 'number') return String(topic);
  if (topic && typeof topic === 'object') {
    return JSON.stringify(topic);
  }
  return 'Unknown';
};

export const decodeEventData = (
  event: SorobanRpc.Api.EventResponse & Record<string, unknown>,
): DecodedEvent | null => {
  try {
    const ledger = typeof event.ledger === 'number'
      ? event.ledger
      : 0;

    const txHash = (event.txHash as string) ?? 'unknown';

    const contractId = String((event as Record<string, unknown>).contractId ?? 'unknown');

    const rawTopic = (event as Record<string, unknown>).topic;
    const topic = topicToString(rawTopic);

    const rawValue: unknown = event.value;
    let data: Record<string, unknown> = {};
    if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
      data = { ...(rawValue as Record<string, unknown>) };
    } else if (typeof rawValue === 'string') {
      data = { raw: rawValue };
    }

    const timestamp = event.ledgerClosedAt
      ? Math.floor(new Date(String(event.ledgerClosedAt)).getTime() / 1000)
      : Math.floor(Date.now() / 1000);

    const eventId = `ev-${ledger}-${txHash}`;

    return { eventId, ledger, txHash, contractId, topic, data, timestamp };
  } catch {
    return null;
  }
};
