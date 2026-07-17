import type { Settings } from "./settings";

/** Where a hit came from, for auto-action eligibility purposes. */
export type AutoSource = "list" | "rule" | "cache" | "fresh";

/**
 * Whether a hit may enter the automatic-processing path at all (the
 * per-category action policy is applied after this gate; ineligible hits
 * degrade to badge-only).
 *
 * HARD LINE: published-list entries may only auto-act when human-confirmed
 * (`tier === "confirmed"`). AI / rule / mention auto-published entries stay
 * badge-only no matter what the per-category policy says — a false positive
 * that slipped through auto-publish must never mute/block/hide by itself.
 * (`/v1/check` enforces the same human-tier filter server-side for legacy
 * clients; this is the client-side half for the synced lite artifact.)
 *
 * Official keyword-rule hits are maintainer-curated but target first-seen
 * accounts with no human review, so they are confined to reply sections
 * regardless of autoScope.
 *
 * Cache and fresh verdicts never auto-act.
 */
export function autoEligible(opts: {
  source: AutoSource;
  tier: "confirmed" | "auto";
  inReply: boolean;
  autoScope: Settings["autoScope"];
}): boolean {
  if (opts.source === "list") {
    if (opts.tier !== "confirmed") return false;
    return opts.autoScope === "all" || opts.inReply;
  }
  if (opts.source === "rule") return opts.inReply;
  return false;
}
