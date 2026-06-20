-- Migration: replace DOUBLE PRECISION with NUMERIC(36,7) for all financial fields
--
-- Canonical unit: Stellar amounts use 7 decimal places (1 XLM = 10_000_000 stroops).
-- NUMERIC(36,7) stores up to 10^29 XLM exactly — safe for all on-chain values.
-- DOUBLE PRECISION has ~15-17 significant decimal digits of precision and cannot
-- represent large stroop integers (e.g. 1_000_000_000_0000000) without rounding.
--
-- Preflight: fail if any existing value would overflow NUMERIC(36,7).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM vesting_schedules WHERE amount > 9.9999999999999999999999999999e28::float8
  ) THEN
    RAISE EXCEPTION 'vesting_schedules.amount contains values out of NUMERIC(36,7) range';
  END IF;
  IF EXISTS (
    SELECT 1 FROM proposals WHERE amount > 9.9999999999999999999999999999e28::float8
  ) THEN
    RAISE EXCEPTION 'proposals.amount contains values out of NUMERIC(36,7) range';
  END IF;
  IF EXISTS (
    SELECT 1 FROM proposal_votes WHERE weight > 9.9999999999999999999999999999e28::float8
  ) THEN
    RAISE EXCEPTION 'proposal_votes.weight contains values out of NUMERIC(36,7) range';
  END IF;
  IF EXISTS (
    SELECT 1 FROM streams
    WHERE total_amount > 9.9999999999999999999999999999e28::float8
       OR claimed_amount > 9.9999999999999999999999999999e28::float8
  ) THEN
    RAISE EXCEPTION 'streams contains values out of NUMERIC(36,7) range';
  END IF;
  IF EXISTS (
    SELECT 1 FROM claim_events WHERE amount > 9.9999999999999999999999999999e28::float8
  ) THEN
    RAISE EXCEPTION 'claim_events.amount contains values out of NUMERIC(36,7) range';
  END IF;
  IF EXISTS (
    SELECT 1 FROM treasury_events WHERE amount > 9.9999999999999999999999999999e28::float8
  ) THEN
    RAISE EXCEPTION 'treasury_events.amount contains values out of NUMERIC(36,7) range';
  END IF;
END $$;

-- vesting_schedules.amount
ALTER TABLE "vesting_schedules"
  ALTER COLUMN "amount" TYPE NUMERIC(36,7) USING "amount"::NUMERIC(36,7);

-- proposals.amount
ALTER TABLE "proposals"
  ALTER COLUMN "amount" TYPE NUMERIC(36,7) USING "amount"::NUMERIC(36,7);

-- proposal_votes.weight
ALTER TABLE "proposal_votes"
  ALTER COLUMN "weight" TYPE NUMERIC(36,7) USING "weight"::NUMERIC(36,7);

-- streams.total_amount, streams.claimed_amount
ALTER TABLE "streams"
  ALTER COLUMN "total_amount"   TYPE NUMERIC(36,7) USING "total_amount"::NUMERIC(36,7),
  ALTER COLUMN "claimed_amount" TYPE NUMERIC(36,7) USING "claimed_amount"::NUMERIC(36,7),
  ALTER COLUMN "claimed_amount" SET DEFAULT 0;

-- claim_events.amount
ALTER TABLE "claim_events"
  ALTER COLUMN "amount" TYPE NUMERIC(36,7) USING "amount"::NUMERIC(36,7);

-- treasury_events.amount (nullable)
ALTER TABLE "treasury_events"
  ALTER COLUMN "amount" TYPE NUMERIC(36,7) USING "amount"::NUMERIC(36,7);

-- Rollback (run manually if needed):
-- ALTER TABLE vesting_schedules ALTER COLUMN amount TYPE DOUBLE PRECISION USING amount::DOUBLE PRECISION;
-- ALTER TABLE proposals ALTER COLUMN amount TYPE DOUBLE PRECISION USING amount::DOUBLE PRECISION;
-- ALTER TABLE proposal_votes ALTER COLUMN weight TYPE DOUBLE PRECISION USING weight::DOUBLE PRECISION;
-- ALTER TABLE streams ALTER COLUMN total_amount TYPE DOUBLE PRECISION USING total_amount::DOUBLE PRECISION;
-- ALTER TABLE streams ALTER COLUMN claimed_amount TYPE DOUBLE PRECISION USING claimed_amount::DOUBLE PRECISION;
-- ALTER TABLE claim_events ALTER COLUMN amount TYPE DOUBLE PRECISION USING amount::DOUBLE PRECISION;
-- ALTER TABLE treasury_events ALTER COLUMN amount TYPE DOUBLE PRECISION USING amount::DOUBLE PRECISION;
