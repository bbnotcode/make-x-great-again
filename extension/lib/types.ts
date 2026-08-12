export type Label = "spam" | "porn_bot" | "likely_spam" | "uncertain" | "legit";

export interface Verdict {
  label: Label;
  confidence: number;
  reasons: string[];
}

export interface CurationRecord {
  userId: string;
  handle: string;
  verdict: Verdict;
  reviewStatus: string;
  model: string;
}

/** Signals scraped passively from the rendered DOM. */
export interface Signals {
  isProfile: boolean;
  userId?: string;
  handle: string;
  displayName: string;
  bio: string;
  hasDefaultAvatar: boolean;
  avatarUrl?: string;
  recentTweets: string[];
  triggeringComment?: string;
  threadTopic?: string;
  accountAgeDays?: number;
  followersCount?: number;
  followingCount?: number;
  /** True when this post belongs to the currently signed-in X account.
   *  Automatic account actions must always skip it. */
  viewerIsSelf?: true;
  /** True when the signed-in viewer follows this account. The viewer's
   *  explicit follow choice outranks regex, public-list and rule hits. */
  viewerFollowing?: true;
  /** The tweet texts above are X machine-translations, not the author's own
   *  words (original unavailable in the DOM). Consumers must not treat the
   *  surface language as an author signal. */
  tweetsTranslated?: boolean;
}

/** Background messages. "list-sync" triggers the public blocklist download
 *  (read-only GET of the official artifact; nothing is uploaded). */
export type BgRequest =
  | { type: "health" }
  | {
      type: "list-lookup-batch";
      identities: Array<{ userId?: string; handle?: string }>;
    }
  | { type: "diagnostics" }
  | { type: "queue-status" }
  | {
      type: "queue-command";
      command: "pause" | "resume" | "cancel" | "retry" | "clear" | "clear-source";
      id?: string;
      source?: "auto" | "bio_rule" | "regex" | "quick";
    }
  | { type: "cache-cleanup" }
  | { type: "stats" }
  | { type: "records" }
  | { type: "list-sync"; force?: boolean }
  // GitHub Device Flow (whitelist self-service login). Runs in the
  // background: github.com's device endpoints don't serve CORS, so the
  // fetches need the optional github.com host permission granted first.
  | { type: "gh_start" }
  | { type: "gh_poll"; deviceCode: string }
  // Content script asks the background to open the options page (e.g. a report
  // needs GitHub authorization the user hasn't granted yet).
  | { type: "open_options" }
  // 举报: the authenticated POST to /v1/report MUST run in the background —
  // a content-script fetch is bound by x.com's CORS/CSP, whereas the SW shares
  // the extension origin the whitelist-apply flow already reports from.
  | { type: "report"; sig: Signals };

export interface BgResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
}
