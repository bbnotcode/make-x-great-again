-- Cost hardening after the 2026-06-30 D1 rows-read incident.
--
-- 1) rate_log: the periodic `DELETE FROM rate_log WHERE created_at<?` (run on
--    every report/appeal/classify rate-record) had no index on created_at, so
--    each delete scanned the whole table. It was the single largest rows-read
--    source in `wrangler d1 insights` (~205M/day). Index the delete predicate.
CREATE INDEX IF NOT EXISTS idx_rate_log_created_at ON rate_log(created_at);

-- 2) review_log: /v1/appeal dedupe does
--    `WHERE action='appeal_submitted' AND lower(handle)=? AND at>=?` against a
--    table that had NO index beyond the PK (~386K rows, INSERT-only, growing).
--    Every appeal full-scanned it. Index (action, at) so the 24h window bounds
--    the scan; handle is filtered in-row.
CREATE INDEX IF NOT EXISTS idx_review_log_action_at ON review_log(action, at);
