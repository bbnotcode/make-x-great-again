-- 2026-07-07 · Recall AI-auto-published NON-porn_bot rows to the review queue.
--
-- The classify-path AI auto-publish lane was precise on porn_bot template
-- floods but produced real false positives on generic "spam" verdicts
-- (marketing / procurement / crypto chatter) — e.g. @Jackywine, a normal
-- AI-content account published off one GPU-procurement post. The code now
-- only auto-publishes porn_bot; this recalls the existing non-porn AI rows
-- (~2.6K) into auto_pending_review for human decision. Reversible: admins
-- re-approve real spam from the queue.

UPDATE accounts
   SET status='auto_pending_review',
       published_at=NULL,
       published_tier=NULL
 WHERE published_tier='ai'
   AND status='human_confirmed'
   AND verdict_label!='porn_bot';
