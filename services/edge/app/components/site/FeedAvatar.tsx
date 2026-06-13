import { useState } from "react";

/** Square/round avatar that falls back to the handle's initial on error. */
export function FeedAvatar({
  handle,
  url,
  className = "size-10",
}: {
  handle: string;
  url?: string;
  className?: string;
}) {
  const [err, setErr] = useState(false);
  const src = url || "https://unavatar.io/twitter/" + encodeURIComponent(handle);
  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-sm font-medium text-muted-foreground ${className}`}
    >
      {err ? (
        (handle || "?").slice(0, 1).toUpperCase()
      ) : (
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          onError={() => setErr(true)}
        />
      )}
    </div>
  );
}

/** Relative time in Chinese. */
export function agoCn(ms?: number): string {
  if (!ms) return "";
  const d = Date.now() - ms;
  const s = Math.round(d / 1000);
  if (s < 10) return "刚刚";
  if (s < 60) return s + " 秒前";
  const m = Math.round(s / 60);
  if (m < 60) return m + " 分钟前";
  const h = Math.round(m / 60);
  if (h < 24) return h + " 小时前";
  return Math.round(h / 24) + " 天前";
}

export const fmtCn = (n?: number) => (typeof n === "number" ? n.toLocaleString("zh-CN") : "—");

/** GitHub mark — lucide dropped its brand glyph, so we inline it. */
export function GhIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.7.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3" />
    </svg>
  );
}
