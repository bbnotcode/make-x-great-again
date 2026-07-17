-- 2026-07-07 · Whitelist ↔ blacklist reconciliation.
--
-- whitelistUpsert only wrote its own (uid, handle) row, so a handle-only
-- whitelist add left same-handle siblings (including uid-bearing
-- human_confirmed rows) on the public list. Real case: @bailyLU was admin-
-- whitelisted but his uid row stayed published in the artifact and /v1/check.
--
-- The code now demotes siblings at whitelist time; this backfills existing
-- conflicts. Idempotent. rejected/removed rows are untouched (unpublished
-- audit history).

UPDATE accounts
   SET status='whitelisted',
       source='admin_whitelist',
       verdict_label='legit',
       confidence=1.0,
       reasons='["whitelisted by admin (handle reconciliation)"]',
       signals_hash=NULL,
       published_at=NULL,
       published_tier=NULL
 WHERE status IN ('human_confirmed','auto_pending_review','auto_legit',
                  'agent_blacklist','agent_whitelist','agent_pending')
   AND lower(handle) IN (SELECT lower(handle) FROM accounts WHERE status='whitelisted');
