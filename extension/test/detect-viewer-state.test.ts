import assert from "node:assert/strict";
import { test } from "node:test";
import { viewerStateFromUserObject } from "../lib/detect";

test("detects following from current relationship_perspectives payloads", () => {
  assert.deepEqual(
    viewerStateFromUserObject({
      legacy: { following: false },
      relationship_perspectives: { following: true },
    }),
    { viewerFollowing: true },
  );
});

test("keeps compatibility with legacy relationship flags", () => {
  assert.deepEqual(
    viewerStateFromUserObject({
      legacy: {
        following: true,
        blocking: true,
        muting: true,
        follow_request_sent: true,
      },
    }),
    {
      viewerFollowing: true,
      viewerBlocking: true,
      viewerMuting: true,
      viewerFollowRequestSent: true,
    },
  );
});

test("does not protect accounts when X reports no following relationship", () => {
  assert.deepEqual(
    viewerStateFromUserObject({
      legacy: { following: false },
      relationship_perspectives: { following: false },
    }),
    {},
  );
});
