-- AlterTable
ALTER TABLE "claim_events" ADD COLUMN "tx_hash" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "checkpoints" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkpoints_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "claim_events_tx_hash_key" ON "claim_events"("tx_hash");
