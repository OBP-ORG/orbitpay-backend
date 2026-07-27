-- AlterTable
ALTER TABLE "claim_events" ADD COLUMN "tx_hash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "claim_events_stream_id_tx_hash_key" ON "claim_events"("stream_id", "tx_hash");
