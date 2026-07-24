import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseViewerRelationshipControl,
  viewerStateFromUserObject,
} from "../lib/detect";

test("parses X profile follow controls into an explicit relationship", () => {
  assert.deepEqual(
    parseViewerRelationshipControl(
      "1868117602356359168-unfollow",
      "正在关注 @maimaiRC_",
    ),
    {
      userId: "1868117602356359168",
      handle: "maimairc_",
      following: true,
    },
  );
  assert.deepEqual(
    parseViewerRelationshipControl("3511226595-follow", "关注 @tongbingxue"),
    {
      userId: "3511226595",
      handle: "tongbingxue",
      following: false,
    },
  );
});

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
