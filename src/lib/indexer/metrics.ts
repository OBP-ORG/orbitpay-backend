import { Gauge, Counter, Registry } from 'prom-client';

export const registry = new Registry();

export const observedLedger = new Gauge({
  name: 'orbitpay_indexer_observed_ledger',
  help: 'Latest ledger sequence observed from RPC',
  registers: [registry],
});

export const indexedLedger = new Gauge({
  name: 'orbitpay_indexer_indexed_ledger',
  help: 'Latest ledger sequence successfully indexed',
  registers: [registry],
});

export const lagSeconds = new Gauge({
  name: 'orbitpay_indexer_lag_seconds',
  help: 'Time in seconds the indexer is behind the chain tip',
  registers: [registry],
});

export const failuresTotal = new Counter({
  name: 'orbitpay_indexer_failures_total',
  help: 'Total number of indexer poll failures',
  registers: [registry],
});

export const retriesTotal = new Counter({
  name: 'orbitpay_indexer_retries_total',
  help: 'Total number of indexer poll retries',
  registers: [registry],
});

export const eventsProcessed = new Counter({
  name: 'orbitpay_indexer_events_processed_total',
  help: 'Total number of events successfully processed',
  labelNames: ['contract'],
  registers: [registry],
});

export const decodeFailures = new Counter({
  name: 'orbitpay_indexer_decode_failures_total',
  help: 'Total number of events that failed decoding',
  labelNames: ['contract'],
  registers: [registry],
});
