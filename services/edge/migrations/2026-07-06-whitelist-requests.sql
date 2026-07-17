-- Self-service whitelist applications. Extension users apply with their
-- GitHub identity (same HMAC reporter fingerprint as reports); a maintainer
-- approves/rejects from the admin console.
CREATE TABLE IF NOT EXISTS whitelist_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  x_user_id   TEXT,                          -- X numeric id when the applicant supplied it
  handle      TEXT NOT NULL,                 -- the X handle the applicant wants whitelisted
  reporter_fp TEXT NOT NULL,                 -- salted HMAC fingerprint, NO PII
  gh_age_days INTEGER,                       -- GH account age at application time
  note        TEXT,                          -- applicant free-text (<=200 chars)
  status      TEXT NOT NULL DEFAULT 'pending', -- pending|approved|rejected
  created_at  INTEGER NOT NULL,
  decided_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_whitelist_requests_status
  ON whitelist_requests(status);
CREATE INDEX IF NOT EXISTS idx_whitelist_requests_fp_status
  ON whitelist_requests(reporter_fp, status);
