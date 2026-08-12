import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_REGEX_INPUT_LENGTH,
  MAX_REGEX_RULES,
  compileRegexRules,
  matchRegexText,
} from "../lib/regex-filter";

test("plain rules default to case-insensitive unicode matching", () => {
  const { compiled, errors } = compileRegexRules(["加我.*私聊", "ONLYFANS"]);
  assert.deepEqual(errors, []);
  assert.equal(matchRegexText("加我看主页再私聊", compiled)?.source, "加我.*私聊");
  assert.equal(matchRegexText("my OnlyFans link", compiled)?.source, "ONLYFANS");
});

test("slash syntax accepts flags and strips stateful flags", () => {
  const { compiled, errors } = compileRegexRules(["/t\\.me\\/[a-z0-9_]+/gi"]);
  assert.deepEqual(errors, []);
  assert.equal(compiled[0]?.regex.flags.includes("g"), false);
  assert.ok(matchRegexText("T.ME/spam_bot", compiled));
  assert.ok(matchRegexText("T.ME/spam_bot", compiled));
});

test("invalid and risky expressions are rejected", () => {
  const { compiled, errors } = compileRegexRules([
    "/[a-/",
    "(a+)+$",
    "(foo)\\1",
    "(a|aa)+$",
    Array.from({ length: 12 }, () => ".*").join(""),
  ]);
  assert.equal(compiled.length, 0);
  assert.equal(errors.length, 5);
});

test("matching examines only a bounded prefix of unusually large rendered text", () => {
  const { compiled } = compileRegexRules(["needle"]);
  assert.equal(matchRegexText(`${"x".repeat(MAX_REGEX_INPUT_LENGTH)}needle`, compiled), null);
  assert.ok(matchRegexText(`needle${"x".repeat(MAX_REGEX_INPUT_LENGTH)}`, compiled));
});

test("rules are deduplicated and capped", () => {
  const input = Array.from({ length: MAX_REGEX_RULES + 3 }, (_, i) => `rule-${i}`);
  input.push("rule-0");
  const { compiled, errors } = compileRegexRules(input);
  assert.equal(compiled.length, MAX_REGEX_RULES);
  assert.equal(errors.at(-1)?.message, `最多保存 ${MAX_REGEX_RULES} 条规则`);
});
