-- CreateTable
CREATE TABLE "dead_letter_events" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "ledger" INTEGER NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "raw_data" JSONB NOT NULL,
    "error" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dead_letter_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dead_letter_events_ledger_tx_hash_idx" ON "dead_letter_events"("ledger", "tx_hash");
