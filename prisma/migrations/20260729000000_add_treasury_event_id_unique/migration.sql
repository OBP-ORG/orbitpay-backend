-- DropIndex
DROP INDEX "treasury_events_tx_hash_key";

-- AlterTable
ALTER TABLE "treasury_events" ADD COLUMN "event_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "treasury_events_event_id_key" ON "treasury_events"("event_id");
