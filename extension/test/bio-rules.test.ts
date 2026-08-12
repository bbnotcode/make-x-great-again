import assert from "node:assert/strict";
import test from "node:test";
import { bioEvidenceHash, matchStrongPornBio } from "../lib/bio-rules";

test("matches the recurring appointment-platform hover-card template", () => {
  assert.equal(matchStrongPornBio("已入住约p平台，入口👉1261.t0027.cc 每晚准时湿播，小号已禁言大号在这")?.label, "porn_bot");
});

test("evidence hash ignores changing redirect URL and promoted handle", () => {
  const a = "已入住约p平台，入口 http://254.t0027.cc 小号已禁言大号在这 @Alpha123";
  const b = "已入住约p平台，入口 http://999.example.cc 小号已禁言大号在这 @Beta456";
  assert.equal(bioEvidenceHash(a), bioEvidenceHash(b));
});

test("matches sexual live-stream redirects with obfuscated spacing", () => {
  assert.ok(matchStrongPornBio("安全＋私密＋线上 👉 远程指挥直播控制玩具，同城可线下！"));
});

test("does not match ordinary uses of platform, privacy or secondary accounts", () => {
  for (const bio of ["软件平台开发者", "注重隐私与安全", "小号记录日常，大号摄影作品"]) {
    assert.equal(matchStrongPornBio(bio), null);
  }
});
