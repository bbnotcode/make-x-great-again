-- One-time category backfill, run 2026-07-06 alongside the category migration.
--
-- Layer 1 — label mapping: porn_bot IS the porn category by definition.
-- Layer 2 — provenance mapping: rows created by a keyword-rule hit record the
--   exact rule pattern in `reasons`, so they inherit the maintainer-curated
--   category of that rule (human curation, not keyword guessing).
-- Everything still NULL after this file is swept by the LLM batch job in the
-- Worker cron (backfillCategories), which categorizes from account context.

-- ---- keyword_rules curation (maintainer-reviewed 2026-07-06) ----
UPDATE keyword_rules SET category='porn' WHERE verdict_label='porn_bot';
UPDATE keyword_rules SET category='marketing' WHERE pattern IN ('点击主页','私信大号','炸裂 快手','炸裂快手','快手博主');
UPDATE keyword_rules SET category='resource'  WHERE pattern IN ('资源','资源自取','quark.cn','twimg.kim','企鹅裙');
UPDATE keyword_rules SET category='crypto'    WHERE pattern IN ('返佣','美股仙入');
UPDATE keyword_rules SET category='gambling'  WHERE pattern IN ('开云体育');

-- ---- Layer 1: label mapping ----
UPDATE accounts SET category='porn' WHERE category IS NULL AND verdict_label='porn_bot';

-- ---- Layer 2: provenance mapping (rule pattern recorded in reasons) ----
-- NOTE: reasons is a JSON-encoded array, so the quotes around the pattern are
-- stored escaped: ... keyword rule \"资源\" on ... — the LIKE patterns below
-- match the escaped form.
UPDATE accounts SET category='marketing' WHERE category IS NULL
  AND (reasons LIKE '%keyword rule \"点击主页\"%' OR reasons LIKE '%keyword rule \"私信大号\"%'
    OR reasons LIKE '%keyword rule \"炸裂 快手\"%' OR reasons LIKE '%keyword rule \"炸裂快手\"%'
    OR reasons LIKE '%keyword rule \"快手博主\"%');
UPDATE accounts SET category='resource' WHERE category IS NULL
  AND (reasons LIKE '%keyword rule \"资源\"%' OR reasons LIKE '%keyword rule \"资源自取\"%'
    OR reasons LIKE '%keyword rule \"quark.cn\"%' OR reasons LIKE '%keyword rule \"twimg.kim\"%'
    OR reasons LIKE '%keyword rule \"企鹅裙\"%');
UPDATE accounts SET category='crypto' WHERE category IS NULL
  AND (reasons LIKE '%keyword rule \"返佣\"%' OR reasons LIKE '%keyword rule \"美股仙入\"%');
UPDATE accounts SET category='gambling' WHERE category IS NULL
  AND reasons LIKE '%keyword rule \"开云体育\"%';
