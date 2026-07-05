-- Category taxonomy for user-side per-category policy control.
-- accounts.category: canonical spam category (porn|crypto|gambling|resource|marketing|other),
-- NULL = not yet categorized (legacy rows until backfill runs).
-- keyword_rules.category: category stamped onto accounts on rule hit.
-- publications.lite_key: R2 object key for the compact "lite" list artifact (schema v2).
ALTER TABLE accounts ADD COLUMN category TEXT;
ALTER TABLE keyword_rules ADD COLUMN category TEXT;
ALTER TABLE publications ADD COLUMN lite_key TEXT;
