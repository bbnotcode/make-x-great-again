-- 2026-07-07 · published_tier: who actually put this row on the public list.
--
-- Problem: every auto-publish lane (classify AI auto-publish, keyword-rule
-- hits, @-mention promotion) writes status='human_confirmed', so the published
-- artifact cannot tell a maintainer-reviewed entry from an unreviewed AI/rule
-- verdict. Clients auto-blocking "confirmed" entries were really auto-blocking
-- AI guesses — the false-positive auto-block reports.
--
-- Fix: annotate provenance in a dedicated column. Queries keep filtering on
-- status='human_confirmed' (no index changes); the artifact/check surfaces
-- read the tier.
--
--   'human'   — admin decide/approve (or pre-auto-lane legacy rows)
--   'ai'      — classify-path AI auto-publish        (review_log ai_blacklist)
--   'rule'    — keyword-rule blacklist hit           (review_log keyword_blacklist)
--   'mention' — @-mention promotion from a rule hit  (review_log keyword_mention_blacklist)
--
-- Backfill derives the tier from the review_log audit trail. Order matters:
-- auto lanes first (fill NULLs), then admin approvals override (a human
-- decision is the final say), then anything still untagged predates the auto
-- lanes entirely → human.

ALTER TABLE accounts ADD COLUMN published_tier TEXT;

-- 1. classify AI auto-publish
UPDATE accounts SET published_tier='ai'
 WHERE status='human_confirmed' AND published_tier IS NULL
   AND x_user_id IN (SELECT x_user_id FROM review_log
                      WHERE action='ai_blacklist' AND x_user_id IS NOT NULL);
UPDATE accounts SET published_tier='ai'
 WHERE status='human_confirmed' AND published_tier IS NULL
   AND lower(handle) IN (SELECT lower(handle) FROM review_log
                          WHERE action='ai_blacklist' AND handle IS NOT NULL);

-- 2. keyword-rule blacklist hits
UPDATE accounts SET published_tier='rule'
 WHERE status='human_confirmed' AND published_tier IS NULL
   AND x_user_id IN (SELECT x_user_id FROM review_log
                      WHERE action='keyword_blacklist' AND x_user_id IS NOT NULL);
UPDATE accounts SET published_tier='rule'
 WHERE status='human_confirmed' AND published_tier IS NULL
   AND lower(handle) IN (SELECT lower(handle) FROM review_log
                          WHERE action='keyword_blacklist' AND handle IS NOT NULL);

-- 3. @-mention promotions (handle-only rows by construction)
UPDATE accounts SET published_tier='mention'
 WHERE status='human_confirmed' AND published_tier IS NULL
   AND lower(handle) IN (SELECT lower(handle) FROM review_log
                          WHERE action='keyword_mention_blacklist' AND handle IS NOT NULL);

-- 4. Human override: an admin approve outranks any auto lane that touched the
--    row earlier (writeAccount never lets auto lanes overwrite a human status,
--    so any approve in the log is authoritative).
UPDATE accounts SET published_tier='human'
 WHERE status='human_confirmed'
   AND (x_user_id IN (SELECT x_user_id FROM review_log
                       WHERE action IN ('approve','agent_promote_blacklist')
                         AND actor='admin' AND x_user_id IS NOT NULL)
        OR lower(handle) IN (SELECT lower(handle) FROM review_log
                              WHERE action IN ('approve','agent_promote_blacklist')
                                AND actor='admin' AND handle IS NOT NULL));

-- 5. Still untagged → published before the auto lanes existed (admin-era).
UPDATE accounts SET published_tier='human'
 WHERE status='human_confirmed' AND published_tier IS NULL;
