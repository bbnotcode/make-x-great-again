-- /v1/list/meta previously scanned the whole human_confirmed partition AND the
-- whole auto_pending_review partition (~185K rows) on every cache miss to get
-- count + pending. Store the pending count on the publications ledger so meta
-- can read it (24-row table); count already lives there. The 10-min publish
-- cron computes it once per run (one bounded scan) instead of per request.
ALTER TABLE publications ADD COLUMN pending_count INTEGER;
