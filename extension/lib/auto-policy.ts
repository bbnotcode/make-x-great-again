import type { CategoryAction, Settings } from "./settings";
import type { Signals } from "./types";

/**
 * Accounts the viewer deliberately follows are always protected from MXGA
 * filtering. This gate must run before regex, blocklist, cache and local-rule
 * handling so a public-list hit can never override the viewer's own choice.
 */
export function viewerProtected(sig: Pick<Signals, "viewerFollowing" | "viewerIsSelf">): boolean {
  return sig.viewerFollowing === true || sig.viewerIsSelf === true;
}

/** Where a hit came from, for auto-action eligibility purposes. */
export type AutoSource = "list" | "rule" | "cache" | "fresh";

/**
 * Whether a hit may enter the automatic-processing path at all (the
 * per-category action policy is applied after this gate; ineligible hits
 * degrade to badge-only).
 *
 * PRODUCT LINE (2026-07-07, reaffirmed 2026-07-18): on the public list =
 * auto-processable, regardless of tier — precision is enforced at the
 * publish source (AI lane confined to porn_bot; rules maintainer-curated).
 * settings.autoTierMode lets cautious users narrow the auto tier: "full"
 * (default) runs the per-category policy as-is, "hide" admits them but
 * `capAutoTierAction` limits them to the reversible local hide, "badge"
 * keeps the old mark-only stance. Tier gating exists server-side ONLY for
 * legacy ≤0.4 clients (`/v1/check` human-only), which auto-block with no
 * tier awareness and no cap.
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
