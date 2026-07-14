// Local keyword-rule engine — the client-side mirror of the server's
// maintainer-curated pre-LLM fast path (keyword_rules, action='blacklist').
// Rules ship inside the synced lite artifact, so brand-new template accounts
// (porn-bot throwaways created an hour ago, not yet on the public list) get
// flagged on first sight with zero upload.
//
// Same red line as the server: rules are HUMAN-CURATED patterns, not local
// guessing — and the same X-auto-translate guard applies: a CJK pattern is
// never matched against tweet text when the author's own profile shows no
// CJK (or the tweet is flagged as machine-translated), because the visible
// text may be X's translation of a legit foreign tweet. Display names / bios
// are not translated by X, so those fields stay fully matchable.
import { type SpamCategory, categoryFromCode } from "./category";
import type { Label, Signals } from "./types";

/** Lite artifact rule row: [pattern, fieldCode, labelCode+categoryCode]. */
export type LiteRuleRow = [string, string, string];

export interface LocalRuleHit {
  pattern: string;
  label: Label;
  category: SpamCategory;
}

interface CompiledRule {
  pattern: string;
  patternLower: string;
  patternCJK: boolean;
  field: "handle" | "display_name" | "bio" | "tweet" | "any";
  label: Label;
  category: SpamCategory;
}

const FIELD_BY_CODE: Record<string, CompiledRule["field"]> = {
  h: "handle",
  d: "display_name",
  b: "bio",
  t: "tweet",
  a: "any",
};

const CJK_RE = /[㐀-鿿豈-﫿]/;
const hasCJK = (s: string | undefined | null) => !!s && CJK_RE.test(s);

let rules: CompiledRule[] = [];

/** Load rules from a synced lite artifact (tolerant: bad rows are skipped). */
export function setLocalRules(raw: unknown): void {
  const next: CompiledRule[] = [];
  if (Array.isArray(raw)) {
    for (const row of raw as LiteRuleRow[]) {
      if (!Array.isArray(row) || row.length < 3) continue;
      const [pattern, fieldCode, code] = row;
      if (typeof pattern !== "string" || !pattern) continue;
      const field = FIELD_BY_CODE[String(fieldCode)];
      if (!field) continue; // unknown field must not widen into match-everything
      next.push({
        pattern,
        patternLower: pattern.toLowerCase(),
        patternCJK: hasCJK(pattern),
        field,
        label: String(code)[0] === "p" ? "porn_bot" : "spam",
        category: categoryFromCode(String(code)[1]),
      });
    }
  }
  rules = next;
}

export function localRuleCount(): number {
  return rules.length;
}

/** First matching blacklist rule for these signals, or null. */
export function matchLocalRules(s: Signals): LocalRuleHit | null {
  if (!rules.length) return null;
  const handle = s.handle.toLowerCase();
  const name = s.displayName.toLowerCase();
  const bio = s.bio.toLowerCase();
  const tweets = [...s.recentTweets, s.triggeringComment ?? ""].map((t) => t.toLowerCase());

  for (const r of rules) {
    const p = r.patternLower;
    // Translate guard: a CJK pattern must not match text X itself rendered
    // as a translation (attribution marker → tweetsTranslated). That marker
    // is the whole guard — an extra "author profile must also show CJK"
    // belt used to sit here, and a porn ring walked straight through it by
    // pairing Latin/kana display names with Chinese spam text (2026-07-14
    // wave: "sao货…" replies from "Gigi 🌸"-style throwaways). A raw
    // non-CJK tweet can never contain a CJK pattern anyway, so the marker
    // check alone carries no extra false-positive surface for originals.
    const tweetTrusted = !r.patternCJK || !s.tweetsTranslated;
    const tweetHit = () => tweetTrusted && tweets.some((t) => t.includes(p));
    const hit =
      r.field === "handle"
        ? handle.includes(p)
        : r.field === "display_name"
          ? name.includes(p)
          : r.field === "bio"
            ? bio.includes(p)
            : r.field === "tweet"
              ? tweetHit()
              : handle.includes(p) || name.includes(p) || bio.includes(p) || tweetHit();
    if (hit) return { pattern: r.pattern, label: r.label, category: r.category };
  }
  return null;
}
