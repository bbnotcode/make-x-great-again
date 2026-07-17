import assert from "node:assert/strict";
import test from "node:test";
import { isArtifactIdentityValid } from "../src/artifact-identity";

test("accepts identities representable in the lite artifact", () => {
  assert.equal(isArtifactIdentityValid("2077936309436637687", "tualatrix"), true);
  assert.equal(isArtifactIdentityValid(null, "handle_only"), true);
  assert.equal(isArtifactIdentityValid("", "legacy_empty_id"), true);
  assert.equal(isArtifactIdentityValid("123", "fifteen_chars_1"), true);
});

test("rejects malformed handles before artifact publication", () => {
  assert.equal(isArtifactIdentityValid(null, "christo59389780  @christo59389780"), false);
  assert.equal(isArtifactIdentityValid(null, "test_xss_migration_dummy"), false);
  assert.equal(isArtifactIdentityValid("123", "@leading_at"), false);
  assert.equal(isArtifactIdentityValid("123", "bad-hyphen"), false);
  assert.equal(isArtifactIdentityValid("123", ""), false);
});

test("rejects malformed numeric user ids", () => {
  assert.equal(isArtifactIdentityValid("not-numeric", "valid_handle"), false);
  assert.equal(isArtifactIdentityValid("1".repeat(33), "valid_handle"), false);
});
