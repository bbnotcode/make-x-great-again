-- 2026-07-07 · Recall published rows with uid-conflict + legit-signal siblings.
--
-- Discovered via @Jackywine: the same handle can carry rows with DIFFERENT
-- x_user_ids (DOM/fiber uid extraction can mis-attribute; handles also get
-- recycled). When one of those rows is PUBLISHED and a sibling with another
-- uid says legit/auto_legit/whitelisted, the published row may be pointing
-- at a normal account — recall it to the review queue for a human decision.
--
-- Handle-recycling among bots (all siblings spam) is left untouched.
-- Idempotent; reversible from the admin queue.

INSERT INTO review_log (x_user_id, handle, action, actor, note, at)
SELECT a.x_user_id, a.handle, 'recall_uid_conflict', 'admin',
       'recalled from public list: same handle carries a different uid with a legit signal (uid mis-attribution risk)',
       strftime('%s','now') * 1000
  FROM accounts a
 WHERE a.status='human_confirmed' AND a.x_user_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM accounts b
                WHERE lower(b.handle)=lower(a.handle)
                  AND b.x_user_id IS NOT NULL AND b.x_user_id != a.x_user_id
                  AND (b.status IN ('auto_legit','whitelisted') OR b.verdict_label='legit'));

UPDATE accounts
   SET status='auto_pending_review',
       published_at=NULL,
       published_tier=NULL
 WHERE status='human_confirmed' AND x_user_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM accounts b
                WHERE lower(b.handle)=lower(accounts.handle)
                  AND b.x_user_id IS NOT NULL AND b.x_user_id != accounts.x_user_id
                  AND (b.status IN ('auto_legit','whitelisted') OR b.verdict_label='legit'));
