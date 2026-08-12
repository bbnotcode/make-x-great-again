export interface StrongBioHit {
  label: "porn_bot";
  rule: string;
  reasons: string[];
}

export const BIO_RULE_VERSION = "bio-v2";

export function bioEvidenceHash(value: string): string {
  // Redact variable and potentially sensitive values before punctuation is
  // normalized away, otherwise different URLs could produce different hashes.
  const redacted = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+|(?:[a-z0-9-]+\.)+(?:com|cc|net)\S*/giu, "<url>")
    .replace(/@[a-z0-9_]{1,15}/giu, "<handle>");
  const source = normalize(redacted);
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

const normalize = (value: string) =>
  value.normalize("NFKC").toLowerCase().replace(/[\s·•｜|+＋，,。.!！:：;；👉👈👇☝️]+/gu, "");

/** High-precision combinations copied from recurring porn-farm bios. A broad
 * word such as “平台” or “私密” can never match by itself. */
export function matchStrongPornBio(value: string): StrongBioHit | null {
  const bio = normalize(value);
  if (!bio) return null;
  const groups: Array<[string, RegExp[]]> = [
    ["约会平台引流模板", [/(?:已入驻|入驻|入住)(?:约p|约炮|约啪|寻欢)(?:平台)?/, /(?:入口|小号|大号|网址|域名|\.cc|\.com)/]],
    ["色情直播引流模板", [/(?:湿播|裸播|成人视频|直播控制玩具|远程指挥)/, /(?:入口|私信|小号|大号|网址|域名|同城|线下)/]],
    ["同城色情服务模板", [/(?:同城可线下|同城约|寻欢必备)/, /(?:安全私密|福利大放送|约p|约炮|湿播|小号)/]],
    ["禁言换号引流模板", [/(?:小号已禁言|小号被禁言|小号封了)/, /(?:大号在这|加大号|入口|@)/]],
  ];
  for (const [rule, required] of groups) {
    if (required.every((pattern) => pattern.test(bio))) {
      return { label: "porn_bot", rule, reasons: [`简介命中强规则：${rule}`] };
    }
  }
  return null;
}
