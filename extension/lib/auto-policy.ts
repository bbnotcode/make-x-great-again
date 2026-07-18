import type { CategoryAction, Settings } from "./settings";

/** Where a hit came from, for auto-action eligibility purposes. */
export type AutoSource = "list" | "rule" | "cache" | "fresh";

/**
 * Whether a hit may enter the automatic-processing path at all (the
 * per-category action policy is applied after this gate; ineligible hits
 * degrade to badge-only).
 *
 * HARD LINE, v2: published-list entries that are NOT human-confirmed
 * (AI / rule / mention auto-published) are governed by settings.autoTierMode:
 * "badge" keeps the original mark-only stance, "hide" (default) admits them
 * but `capAutoTierAction` limits them to the reversible local hide, "full"
 * runs the per-category policy as-is (explicit user opt-in). Rationale: 90%+
 * of the live list is auto tier — mark-only made 自动处理 a no-op against the
 * actual reply-wave, while a first-seen account matching the same keyword
 * rule WOULD auto-act; getting listed must not weaken handling.
 * (`/v1/check` still enforces human-tier-only server-side for legacy ≤0.4
 * clients, which have no tier awareness and no cap.)
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
  autoTierMode: Settings["autoTierMode"];
}): boolean {
  if (opts.source === "list") {
    if (opts.tier !== "confirmed" && opts.autoTierMode === "badge") return false;
    return opts.autoScope === "all" || opts.inReply;
  }
  if (opts.source === "rule") return opts.inReply;
  return false;
}

/** Cap the per-category action for an eligible hit by its tier. Irreversible
 *  X-native mute/block stays human-confirmed-only unless the user explicitly
 *  opted the auto tier into "full"; under "hide" the action degrades to the
 *  local (reversible, zero-network) hide. Rule hits pass through unchanged —
 *  they already carry their own reply-section confinement. */
export function capAutoTierAction(
  action: CategoryAction,
  opts: { source: AutoSource; tier: "confirmed" | "auto"; autoTierMode: Settings["autoTierMode"] },
): CategoryAction {
  if (opts.source !== "list" || opts.tier === "confirmed" || opts.autoTierMode === "full")
    return action;
  return action === "badge" ? "badge" : "hide";
}
