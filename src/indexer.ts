import express from 'express';
import { config } from './config';
import { getHealthCheckResult } from './lib/health';
import { createIndexerEngine } from './lib/indexer/engine';

type IndexerState = {
  lastPollAt: string | null;
  lastSuccessfulPollAt: string | null;
  lastError: string | null;
  currentLedger: number | null;
};

const engine = createIndexerEngine();

const app = express();

app.get('/health', async (_req, res) => {
  const baseHealth = await getHealthCheckResult('indexer');
  const engineState = engine.getState();
  const status =
    baseHealth.status === 'ok' && !engineState.lastError ? 'ok' : 'degraded';

  res.status(status === 'ok' ? 200 : 503).json({
    ...baseHealth,
    status,
    indexer: engineState,
  });
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', 'text/plain');
  res.send(await engine.getMetrics());
});

const server = app.listen(config.indexerPort, () => {
  console.log(`OrbitPay indexer is running on port ${config.indexerPort}`);
  engine.start();
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down indexer...');
  engine.stop();
  server.close();
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down indexer...');
  engine.stop();
  server.close();
});
