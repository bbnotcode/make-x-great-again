import { SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type Account, api, AuthError, type Item, rowKey } from "@/lib/adminApi";
import { ago, fmtN, verdictZh, VERDICTS } from "@/lib/format";
import { runBatch } from "@/lib/runBatch";
import { useSelection } from "@/lib/useSelection";
import { cn } from "@/lib/utils";
import { AccountRow } from "./AccountRow";
import { BatchBar } from "./BatchBar";
import { useConfirm } from "./confirm";
import { EmptyState, ListShell, MoreFoot } from "./MoreFoot";
import { ViewHead } from "./ViewHead";

const QUEUE_SORT = [
  { value: "severity", label: "风险等级（默认）" },
  { value: "conf_desc", label: "把握 高→低" },
  { value: "conf_asc", label: "把握 低→高" },
  { value: "rep_desc", label: "举报 多→少" },
  { value: "created_desc", label: "注册 新→旧" },
  { value: "created_asc", label: "注册 旧→新" },
  { value: "followers_desc", label: "粉丝 多→少" },
  { value: "following_desc", label: "关注 多→少" },
  { value: "time_desc", label: "最近更新" },
];
const CHIPS = ["all", "spam", "porn_bot", "likely_spam", "uncertain", "legit"] as const;
const CHIP_LABEL: Record<string, string> = {
  all: "全部",
  spam: "垃圾营销",
  porn_bot: "色情广告号",
  likely_spam: "疑似垃圾",
  uncertain: "不确定",
  legit: "正常账号",
};
const FIELDS: { k: string; label: string; ph: string }[] = [
  { k: "handle", label: "Handle 包含", ph: "如 spam_" },
  { k: "uid", label: "UID 前缀", ph: "如 2056413" },
  { k: "evidence", label: "推文内容包含", ph: "如 比她好看" },
  { k: "display_name", label: "显示名包含", ph: "如 Mary" },
  { k: "reasons", label: "Reasons 包含", ph: "如 导流模板" },
];
type Filters = { q: string; uid: string; handle: string; evidence: string; display_name: string; reasons: string };
const EMPTY: Filters = { q: "", uid: "", handle: "", evidence: "", display_name: "", reasons: "" };

export function QueueTab({ onAuth, onMutated }: { onAuth: () => void; onMutated: () => void }) {
  const confirm = useConfirm();
  const [queue, setQueue] = useState<Account[]>([]);
  const [sort, setSort] = useState("severity");
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [chip, setChip] = useState<string>("all");
  const [adv, setAdv] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const cursor = useRef<number | null>(null);
  const draftQ = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (more: boolean, f: Filters, so: string) => {
      const parts = ["limit=100"];
      if (more && cursor.current) parts.push(`before=${cursor.current}`);
      if (so) parts.push(`sort=${encodeURIComponent(so)}`);
      for (const k of Object.keys(f) as (keyof Filters)[]) {
        if (f[k]) parts.push(`${k}=${encodeURIComponent(f[k])}`);
      }
      try {
        const j = await api.queue(`?${parts.join("&")}`);
        cursor.current = j.nextBefore;
        setHasMore(!!j.nextBefore);
        setQueue((prev) => (more ? prev.concat(j.queue) : j.queue));
        if (j.appliedFilters?.sort) setSort(j.appliedFilters.sort);
      } catch (e) {
        if (e instanceof AuthError) onAuth();
      }
    },
    [onAuth],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only initial load
  useEffect(() => {
    load(false, EMPTY, "severity");
  }, []);

  const apply = (f: Filters, so = sort) => {
    cursor.current = null;
    setFilters(f);
    load(false, f, so);
  };
  const activeFilters = Object.entries(filters).filter(([k, v]) => k !== "q" && v).length;

  const visible = chip === "all" ? queue : queue.filter((a) => a.verdict_label === chip);
  const keys = visible.map(rowKey);
  const sel = useSelection(keys);
  const counts = (k: string) =>
    k === "all" ? queue.length : queue.filter((a) => a.verdict_label === k).length;

  const decide = async (a: Account, action: string) => {
    try {
      await api.decide(a.handle, a.x_user_id, action);
      setQueue((q) => q.filter((x) => rowKey(x) !== rowKey(a)));
      onMutated();
    } catch {
      toast.error("操作失败");
    }
  };

  const batch = (action: string, label: string, variant: "destructive" | "default") => async () => {
    const keysArr = [...sel.sel];
    const ok = await confirm({
      title: `批量${label}`,
      body: (
        <p>
          确认对已选 <b>{keysArr.length}</b> 条执行「{label}」？写 review_log，不可批量撤回。
        </p>
      ),
      okLabel: `${label} ${keysArr.length} 条`,
      okVariant: variant,
    });
    if (!ok) return;
    if (await runBatch(keysArr, label, (items: Item[]) => api.decideBatch(action, items))) {
      const set = new Set(keysArr);
      setQueue((q) => q.filter((a) => !set.has(rowKey(a))));
      sel.clear();
      onMutated();
    }
  };

  return (
    <div>
      <ViewHead
        title="待审队列"
        count={fmtN(queue.length) + (hasMore ? "+" : "")}
        desc={
          <>
            AI 与举报汇入的待裁决账号。<b className="text-destructive">拉黑</b> → 进公榜 ·{" "}
            <b className="text-success">白名单</b> → 永不再扫 · 驳回 / 移除 → 不公开。
          </>
        }
      />

      {/* search + sort */}
      <form
        className="mb-3 grid grid-cols-1 items-end gap-2.5 sm:grid-cols-[minmax(220px,1fr)_180px_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          apply({ ...filters, q: draftQ.current?.value.trim() || "" });
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label className="text-[11.5px] font-normal text-muted-foreground">搜索</Label>
          <Input ref={draftQ} type="search" defaultValue={filters.q} placeholder="handle / uid / 推文内容 / 理由" className="h-9" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-[11.5px] font-normal text-muted-foreground">排序</Label>
          <Select value={sort} onValueChange={(s) => apply(filters, s)}>
            <SelectTrigger className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUEUE_SORT.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button type="submit" variant="outline" size="sm" className="h-9">
            搜索
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => setAdv((v) => !v)}>
            <SlidersHorizontal className="size-3.5" /> 更多筛选{activeFilters > 0 && ` · ${activeFilters}`}
          </Button>
        </div>
      </form>

      {adv && (
        <div className="mb-3 rounded-lg border bg-muted/40 p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FIELDS.map((f) => (
              <div key={f.k} className="flex flex-col gap-1.5">
                <Label className="text-[11.5px] font-normal text-muted-foreground">{f.label}</Label>
                <Input
                  defaultValue={(filters as Record<string, string>)[f.k]}
                  placeholder={f.ph}
                  className="h-8"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      apply({ ...filters, [f.k]: (e.target as HTMLInputElement).value.trim() });
                    }
                  }}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>每个字段是「包含」匹配（uid 是「前缀」）；多字段为 AND。回车应用。</span>
            {activeFilters > 0 && (
              <Button variant="ghost" size="sm" onClick={() => apply({ ...EMPTY, q: filters.q })}>
                清空筛选
              </Button>
            )}
          </div>
        </div>
      )}

      {/* verdict chips */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {CHIPS.map((k) => (
          <button
            type="button"
            key={k}
            onClick={() => setChip(k)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition",
              chip === k
                ? "border-foreground bg-foreground text-background"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {CHIP_LABEL[k]}
            <span className="ml-1.5 text-[10.5px] tabular-nums opacity-70">{counts(k)}</span>
          </button>
        ))}
      </div>

      <BatchBar
        selected={sel.selected}
        visible={visible.length}
        allChecked={sel.allChecked}
        indeterminate={sel.indeterminate}
        onToggleAll={sel.toggleAll}
        actions={
          <>
            <Button size="sm" variant="destructive" onClick={batch("approve", "拉黑", "destructive")}>
              批量拉黑
            </Button>
            <Button size="sm" variant="outline" onClick={batch("reject", "驳回", "default")}>
              批量驳回
            </Button>
            <Button size="sm" variant="ghost" onClick={batch("remove", "移除", "destructive")}>
              批量移除
            </Button>
            <Button size="sm" variant="ghost" onClick={sel.clear}>
              清空选择
            </Button>
          </>
        }
      />

      {visible.length === 0 ? (
        <EmptyState>队列为空。AI 与举报会持续汇入这里。</EmptyState>
      ) : (
        <ListShell>
          {visible.map((a, i) => {
            const label = a.verdict_label || "uncertain";
            return (
              <AccountRow
                key={rowKey(a)}
                a={a}
                label={{ text: verdictZh(label), tone: VERDICTS[label]?.tone || "muted" }}
                selected={sel.sel.has(rowKey(a))}
                onToggle={(shift) => sel.toggle(i, shift)}
                confidence={Math.round((a.confidence || 0) * 100)}
                reporters={a.reporters || 0}
                subExtra={
                  <span title={new Date(a.last_scored || a.published_at || 0).toLocaleString("zh-CN")}>
                    · 入队 {ago(a.last_scored || a.published_at)}
                  </span>
                }
                actions={
                  <>
                    <Button size="sm" variant="destructive" onClick={() => decide(a, "approve")}>
                      拉黑
                    </Button>
                    <Button size="sm" variant="outline" className="text-success" onClick={() => decide(a, "whitelist")}>
                      白名单
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => decide(a, "reject")}>
                      驳回
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => decide(a, "remove")}>
                      移除
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="ghost">
                          找同类 ▾
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => { setAdv(true); apply({ ...EMPTY, handle: a.handle }); }}>
                          按 handle：{a.handle}
                        </DropdownMenuItem>
                        {a.x_user_id && (
                          <DropdownMenuItem onClick={() => { setAdv(true); apply({ ...EMPTY, uid: a.x_user_id ?? "" }); }}>
                            按 UID 前缀：{a.x_user_id}
                          </DropdownMenuItem>
                        )}
                        {a.display_name && (
                          <DropdownMenuItem onClick={() => { setAdv(true); apply({ ...EMPTY, display_name: a.display_name ?? "" }); }}>
                            按显示名：{a.display_name}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                }
              />
            );
          })}
        </ListShell>
      )}
      <MoreFoot
        hasMore={hasMore}
        onMore={() => load(true, filters, sort)}
        text={`已加载 ${fmtN(queue.length)} 条${hasMore ? "" : "（全部）"}`}
      />
    </div>
  );
}
