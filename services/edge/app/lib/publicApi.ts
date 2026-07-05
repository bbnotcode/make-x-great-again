// Public (unauthenticated) data endpoints used by the landing + list pages.

export interface FeedRow {
  x_user_id?: string;
  handle: string;
  display_name?: string;
  avatar_url?: string;
  verdict_label?: string;
  confidence?: number;
  published_at?: number;
  reporters?: number;
  reasons?: string | string[];
  evidence_text?: string;
}
export interface Meta {
  count: number;
  day: number;
  week: number;
  pending: number;
  generatedAt?: number;
  latestAt?: number;
}
export interface TrendPoint {
  at: number;
  count: number;
}
export interface Trends {
  hourly: TrendPoint[];
  daily: TrendPoint[];
  now?: number;
}
export interface ListResp {
  list: FeedRow[];
  latestAt?: number;
  nextBefore?: number | null;
}

const j = <T>(url: string) => fetch(url).then((r) => r.json() as Promise<T>);

export const publicApi = {
  meta: () => j<Meta>("/v1/list/meta"),
  trends: () => j<Trends>("/v1/list/trends?tz=" + encodeURIComponent(new Date().getTimezoneOffset())),
  list: (qs = "?limit=100") => j<ListResp>("/v1/list" + qs),
};

export const VERDICT_ZH: Record<string, string> = {
  spam: "垃圾营销",
  likely_spam: "疑似垃圾",
  porn_bot: "色情广告",
  uncertain: "待复核",
  legit: "正常",
};

export function feedKey(r: FeedRow) {
  return (r.x_user_id || "") + "|" + r.handle;
}
