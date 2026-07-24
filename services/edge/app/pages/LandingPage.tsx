import { ChevronRight, Database, ExternalLink, List, Lock, ShieldCheck, TriangleAlert, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { agoCn, FeedAvatar, fmtCn, GhIcon } from "@/components/site/FeedAvatar";
import { SiteLayout } from "@/components/site/SiteLayout";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BRAND } from "@/lib/brand";
import { type FeedRow, feedKey, type Meta, publicApi, type Trends, VERDICT_ZH } from "@/lib/publicApi";
import { Area, AreaChart, Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";

const X_ICON = (
  <svg viewBox="0 0 24 24" fill="currentColor" className="size-3" role="img" aria-label="X">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const APPLE_ICON = (
  <svg viewBox="0 0 384 512" fill="currentColor" className="inline size-2.5 align-[-1px]" aria-hidden="true">
    <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
  </svg>
);

function StoreBadge({
  href,
  logo,
  sub,
  name,
  onInstall,
  warm,
}: {
  href: string;
  logo: string;
  sub: React.ReactNode;
  name: string;
  warm?: boolean;
  onInstall: (e: React.MouseEvent, url: string) => void;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(e) => onInstall(e, href)}
      className={`group inline-flex min-w-[212px] cursor-pointer items-center gap-3.5 rounded-2xl border border-border/70 px-4 py-2.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-foreground/25 hover:shadow-lg hover:shadow-black/5 ${warm ? "bg-gradient-to-b from-warning/5 to-card" : "bg-card"}`}
    >
      <img src={logo} alt="" width={34} height={34} className="size-[34px]" />
      <span className="flex flex-col">
        <span className="text-[11px] font-medium text-muted-foreground">{sub}</span>
        <span className="flex items-center gap-0.5 text-base font-semibold leading-tight">
          {name}
          <ChevronRight className="size-3.5 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
        </span>
      </span>
    </a>
  );
}

function HeroStats() {
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => {
    const f = () => publicApi.meta().then(setMeta).catch(() => {});
    f();
    const id = setInterval(f, 60000);
    return () => clearInterval(id);
  }, []);
  const cells = [
    { n: fmtCn(meta?.count), l: "已确认" },
    { n: meta ? (meta.day > 0 ? "+" : "") + fmtCn(meta.day) : "—", l: "24h新增" },
    { n: meta ? (meta.week > 0 ? "+" : "") + fmtCn(meta.week) : "—", l: "本周新增" },
    { n: fmtCn(meta?.pending), l: "待复核" },
  ];
  return (
    <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-border/70 bg-card">
      <div className="grid grid-cols-2">
        {cells.map((c, i) => (
          <div
            key={i}
            className={`p-4 ${i % 2 === 0 ? "border-r border-border/60" : ""} ${i < 2 ? "border-b border-border/60" : ""}`}
          >
            <div className="font-mono text-2xl font-bold tabular-nums">{c.n}</div>
            <div className="mt-0.5 text-[12px] text-muted-foreground">{c.l}</div>
          </div>
        ))}
      </div>
      <p className="flex items-center justify-center gap-1.5 border-t border-border/60 bg-muted/30 py-2 text-[11.5px] text-muted-foreground">
        <span className="size-1.5 animate-pulse rounded-full bg-success" />
        {meta?.generatedAt ? `刚刚同步 ${agoCn(meta.generatedAt)}` : "每分钟同步"}
      </p>
    </div>
  );
}

function LiveFeed() {
  const [rows, setRows] = useState<FeedRow[]>([]);
  const [status, setStatus] = useState("连接中...");
  const latest = useRef<number | undefined>(undefined);
  useEffect(() => {
    publicApi
      .list("?limit=6")
      .then((j) => {
        setRows((j.list || []).slice(0, 6));
        latest.current = j.latestAt;
        setStatus(`已同步 ${(j.list || []).length} 条`);
      })
      .catch(() => setStatus("连接失败"));
    const id = setInterval(async () => {
      if (!latest.current) return;
      try {
        const j = await publicApi.list(`?limit=6&since=${latest.current}`);
        const fresh = j.list || [];
        setRows((prev) => {
          const seen = new Set(prev.map(feedKey));
          const added = fresh.filter((r) => !seen.has(feedKey(r)));
          if (!added.length) return prev;
          setStatus(`+${added.length} 条新增`);
          latest.current = j.latestAt || latest.current;
          return added.concat(prev).slice(0, 6);
        });
      } catch {}
    }, 20000);
    return () => clearInterval(id);
  }, []);
  return (
    <section className="mt-20">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <span className="size-1.5 animate-pulse rounded-full bg-destructive" /> Live
          </span>
          <h2 className="mt-1.5 text-xl font-semibold tracking-tight">最近处理</h2>
        </div>
        <Link
          to="/list"
          className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          完整名单 <ChevronRight className="size-3.5" />
        </Link>
      </div>
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
        {rows.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">{status}</div>
        ) : (
          <div className="divide-y divide-border/60">
            {rows.map((r, i) => {
              const lbl = r.verdict_label || "uncertain";
              return (
                <div key={feedKey(r)} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/40">
                  <span className="w-7 font-mono text-[11px] tabular-nums text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                  <FeedAvatar handle={r.handle} url={r.avatar_url} className="size-8" />
                  <div className="min-w-0 flex-1">
                    <a href={`https://x.com/${r.handle}`} target="_blank" rel="noopener noreferrer" className="truncate text-sm font-medium hover:text-info">
                      {(r.display_name || "").trim() || `@${r.handle}`}
                    </a>
                    <div className="text-[11px] text-muted-foreground">{VERDICT_ZH[lbl] || lbl}</div>
                  </div>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {Math.round((r.confidence || 0) * 100)}%
                  </span>
                  <span className="hidden text-[11px] tabular-nums text-muted-foreground sm:block">{agoCn(r.published_at)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function TrendCharts() {
  const [t, setT] = useState<Trends | null>(null);
  useEffect(() => {
    const f = () => publicApi.trends().then(setT).catch(() => {});
    f();
    const id = setInterval(f, 60000);
    return () => clearInterval(id);
  }, []);
  const hourly = (t?.hourly || []).slice(-24);
  const daily = t?.daily || [];
  const sum = (a: { count: number }[]) => a.reduce((s, p) => s + (p.count || 0), 0);
  const plus = (n: number) => (n > 0 ? `+${fmtCn(n)}` : fmtCn(n));
  return (
    <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="rounded-2xl border border-border/70 bg-card p-5">
        <header className="mb-3 flex items-end justify-between">
          <div>
            <h3 className="text-[15px] font-semibold">过去 24 小时</h3>
            <p className="text-[12px] text-muted-foreground">每小时新增 spam</p>
          </div>
          <strong className="font-mono text-lg tabular-nums">{plus(sum(hourly))}</strong>
        </header>
        <ResponsiveContainer width="100%" height={150}>
          <AreaChart data={hourly} margin={{ top: 6, right: 6, left: 6, bottom: 0 }}>
            <defs>
              <linearGradient id="g24" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--info)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--info)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="at" hide />
            <Tooltip
              contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
              labelFormatter={(v) => new Date(v as number).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
              formatter={(v) => [`${v} 条`, "新增"]}
            />
            <Area type="monotone" dataKey="count" stroke="var(--info)" strokeWidth={2} fill="url(#g24)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="rounded-2xl border border-border/70 bg-card p-5">
        <header className="mb-3 flex items-end justify-between">
          <div>
            <h3 className="text-[15px] font-semibold">过去一周</h3>
            <p className="text-[12px] text-muted-foreground">每天处理 spam</p>
          </div>
          <strong className="font-mono text-lg tabular-nums">{plus(sum(daily))}</strong>
        </header>
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={daily} margin={{ top: 6, right: 6, left: 6, bottom: 0 }}>
            <XAxis
              dataKey="at"
              tickFormatter={(v) => new Date(v as number).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}
              tickLine={false}
              axisLine={false}
              fontSize={11}
              stroke="var(--muted-foreground)"
            />
            <Tooltip
              cursor={{ fill: "var(--accent)" }}
              contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
              labelFormatter={(v) => new Date(v as number).toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short" })}
              formatter={(v) => [`${v} 条`, "处理"]}
            />
            <Bar dataKey="count" fill="var(--violet)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

const PILLARS = [
  { n: "01", h: "拦垃圾评论", p: "标出广告、色情引流和模板回复。你确认后再拉黑。", s: "已上线", tone: "text-success" },
  { n: "02", h: "识别账号", p: "计划显示账号年龄、常聊话题和互动质量。", s: "下一站", tone: "text-info" },
  { n: "03", h: "速览主页", p: "计划总结主题、高赞内容和活跃时间。", s: "规划中", tone: "text-muted-foreground" },
  { n: "04", h: "看清传播", p: "计划显示你关注的人是否转评过。", s: "规划中", tone: "text-muted-foreground" },
  { n: "05", h: "导出数据", p: "计划导出关注、收藏和自己的推文。", s: "规划中", tone: "text-muted-foreground" },
];
const TRUST = [
  { Icon: ShieldCheck, h: "模型不定案", p: "模型只给理由；进名单要人工确认或多人上报。", c: "text-success" },
  { Icon: Lock, h: "不碰登录态", p: "不上传 Cookie、关注列表和浏览历史。", c: "text-info" },
  { Icon: Database, h: "操作留痕", p: "加入、移除、白名单、驳回都有记录，git history 可审计。", c: "text-warning" },
  { Icon: User, h: "GitHub 上报", p: "登录只用于防刷和追溯提交。", c: "text-violet" },
];

export function LandingPage() {
  const [pending, setPending] = useState<string | null>(null);
  const onInstall = (e: React.MouseEvent, url: string) => {
    try {
      if (localStorage.getItem("mxga_risk_ack") === "1") return;
    } catch {}
    e.preventDefault();
    setPending(url);
  };
  const ack = () => {
    try {
      localStorage.setItem("mxga_risk_ack", "1");
    } catch {}
  };

  return (
    <SiteLayout current="home">
      <section className="grid grid-cols-1 items-center gap-10 py-12 sm:py-16 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/60 px-3 py-1 text-[11.5px] font-semibold text-muted-foreground backdrop-blur">
            <span className="size-1.5 rounded-full bg-success" />
            {X_ICON} Chrome / Firefox / Safari 扩展 · {BRAND.license} 开源
          </span>
          <h1 className="mt-5 font-serif text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
            Make X Great Again
            <span className="mt-1 block text-3xl font-normal text-muted-foreground sm:text-4xl">
              少看垃圾，多看人话。
            </span>
          </h1>
          <p className="mt-5 text-[17px] leading-relaxed text-muted-foreground">
            广告号、色情引流先标出；拉黑由你确认。
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <StoreBadge href={BRAND.chromeWebStore} logo="/store-chrome.svg" sub="Chrome · Edge · Brave · Arc" name="Chrome 网上应用店" onInstall={onInstall} />
            <StoreBadge href={BRAND.firefoxAddons} logo="/store-firefox.svg" sub="Firefox 浏览器" name="Firefox 附加组件" onInstall={onInstall} warm />
            <StoreBadge
              href={BRAND.testFlight}
              logo="/store-safari.svg"
              sub={<>Safari · {APPLE_ICON} iOS · iPadOS · macOS</>}
              name="TestFlight 测试版"
              onInstall={onInstall}
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/list">
                <List className="size-4" /> 看公开名单
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <a href={BRAND.repo} target="_blank" rel="noreferrer noopener">
                <GhIcon className="size-4" /> 看源码
              </a>
            </Button>
          </div>
          <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted-foreground">
            <span>Chrome / Firefox 已上架，TestFlight 开放测试</span> · <span>手动拉黑</span> · <span>不存身份</span> · <span>开源</span>
          </p>
        </div>
        <div className="flex flex-col items-center gap-6">
          <div className="relative">
            <div
              aria-hidden
              className="absolute inset-0 -z-10 scale-90 rounded-full bg-info/20 blur-3xl"
            />
            <img src="/mxga-hero.png" alt="" width={320} height={320} className="w-60 drop-shadow-xl lg:w-72" />
          </div>
          <HeroStats />
        </div>
      </section>

      <aside className="flex items-start gap-4 rounded-2xl border border-warning/30 bg-warning/[0.06] p-5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning">
          <TriangleAlert className="size-5" />
        </span>
        <div className="min-w-0">
          <strong className="text-[14px] font-semibold">账号风控提醒 · 请克制、分批拉黑</strong>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            X 会对短时间内连续、大量拉黑触发风控，可能导致 Ghost Ban、功能受限甚至冻结。MXGA 默认只「标注」，拉黑始终由你手动确认 —— 请量力而行，分批处理。
          </p>
          <a href={BRAND.governance} target="_blank" rel="noreferrer noopener" className="mt-2 inline-block text-[12.5px] text-warning hover:underline">
            了解我们如何降低误伤与风险 →
          </a>
        </div>
      </aside>

      <LiveFeed />
      <TrendCharts />

      <section className="mt-20">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Roadmap</p>
        <h2 className="mt-1.5 text-2xl font-semibold tracking-tight">先救评论区，再做深</h2>
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PILLARS.map((p) => (
            <div
              key={p.n}
              className="group flex items-start gap-3 rounded-2xl border border-border/70 bg-card p-4 transition-colors hover:border-foreground/15 hover:bg-accent/30"
            >
              <span className="font-mono text-sm text-muted-foreground/70">{p.n}</span>
              <div className="min-w-0 flex-1">
                <h3 className="text-[15px] font-semibold">{p.h}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{p.p}</p>
              </div>
              <span className={`shrink-0 text-[11px] font-semibold ${p.tone}`}>{p.s}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-20">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Trust</p>
        <h2 className="mt-1.5 text-2xl font-semibold tracking-tight">规则公开，误伤可撤</h2>
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {TRUST.map((t) => (
            <div
              key={t.h}
              className="flex items-start gap-3 rounded-2xl border border-border/70 bg-card p-4 transition-colors hover:border-foreground/15 hover:bg-accent/30"
            >
              <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted ${t.c}`}>
                <t.Icon className="size-[18px]" />
              </span>
              <div>
                <h3 className="text-[15px] font-semibold">{t.h}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{t.p}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <Dialog open={pending !== null} onOpenChange={(open) => {
        if (!open) {
          ack();
          setPending(null);
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TriangleAlert className="size-5 text-warning" /> 安装前，请先了解风控风险
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-[13px] leading-relaxed">
                <p>MXGA 帮你识别广告号和色情引流号，但拉黑动作发生在你自己的 X 账号上。安装前请知悉：</p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>短时间内连续、大量拉黑可能触发 Ghost Ban、功能限制甚至冻结。</li>
                  <li>请分批、克制地处理，不要叠加其他高频批量操作。</li>
                  <li>是否拉黑始终由你手动确认，扩展不会替你自动执行。</li>
                </ul>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { ack(); setPending(null); }}>
              再想想
            </Button>
            <Button
              size="sm"
              onClick={() => {
                ack();
                const url = pending;
                setPending(null);
                if (url) window.open(url, "_blank", "noopener");
              }}
            >
              已了解，前往安装 <ExternalLink className="size-3.5" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SiteLayout>
  );
}
