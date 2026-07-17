import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { type Account, type AgentItem, api, AuthError, rowKey, selToItems } from "@/lib/adminApi";
import { ago, fmtN, verdictZh, VERDICTS } from "@/lib/format";
import { BATCH_CHUNK, chunk } from "@/lib/adminApi";
import { useSelection } from "@/lib/useSelection";
import { AccountRow } from "./AccountRow";
import { BatchBar } from "./BatchBar";
import { useConfirm } from "./confirm";
import { EmptyState, ListShell, MoreFoot } from "./MoreFoot";
import { ViewHead } from "./ViewHead";

type Bucket = "pending" | "blacklist" | "whitelist";
const BUCKET_ZH: Record<Bucket, string> = { pending: "待定", blacklist: "拟拉黑", whitelist: "拟加白" };
const DESC: Record<Bucket, string> = {
  pending: "agent 看过但拿不准的条目。可能信号薄弱、可能账号已被 X 封、可能你需要亲眼看一眼。",
  blacklist: "agent 给出高置信 spam 判定，尚未公开。点「确认拉黑」升级到公榜（公开拉黑）。",
  whitelist: "agent 给出高置信 legit 判定，尚未进白名单。点「确认加白」才会真正入官方白名单。",
};

function jsonArr(s?: string): string[] {
  try {
    const v = JSON.parse(s || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function promoteBatch(keys: string[], target: string, label: string) {
  const chunks = chunk(keys, BATCH_CHUNK);
  const id = toast.loading(`批量${label} 0/${keys.length}`);
  let done = 0;
  for (const slice of chunks) {
    const items: AgentItem[] = selToItems(slice).map((it) =>
      it.xUserId ? { handle: it.handle, x_user_id: it.xUserId } : { handle: it.handle },
    );
    try {
      const j = await api.agentPromoteBatch(target, items);
      if (!j.ok) throw new Error();
      done += slice.length;
      toast.loading(`批量${label} ${done}/${keys.length}`, { id });
    } catch {
      toast.error(`批量${label}失败`, { id });
      return false;
    }
  }
  toast.success(`完成 · ${done} 条`, { id });
  return true;
}

export function AgentTab({
  bucket,
  onAuth,
  onMutated,
}: {
  bucket: Bucket;
  onAuth: () => void;
  onMutated: () => void;
}) {
  const confirm = useConfirm();
  const [rows, setRows] = useState<Account[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const cursor = useRef<number | null>(null);

  const load = useCallback(
    async (more: boolean) => {
      const parts = [`bucket=${bucket}`, "limit=100"];
      if (more && cursor.current) parts.push(`before=${cursor.current}`);
      try {
        const j = await api.agentList(`?${parts.join("&")}`);
        cursor.current = j.nextBefore;
        setHasMore(!!j.nextBefore);
        setRows((prev) => (more ? prev.concat(j.list) : j.list));
      } catch (e) {
        if (e instanceof AuthError) onAuth();
      }
    },
    [bucket, onAuth],
  );

  useEffect(() => {
    cursor.current = null;
    load(false);
  }, [load]);

  const keys = rows.map(rowKey);
  const sel = useSelection(keys);

  const primary =
    bucket === "whitelist"
      ? { target: "whitelist", label: "确认加白", variant: "success" as const }
      : { target: "blacklist", label: "确认拉黑", variant: "destructive" as const };

  const promoteOne = async (a: Account, target: string) => {
    try {
      const j = await api.agentPromote(a.handle, a.x_user_id, target);
      if (!j.ok) throw new Error();
      setRows((r) => r.filter((x) => rowKey(x) !== rowKey(a)));
      onMutated();
    } catch {
      toast.error("操作失败");
      load(false);
    }
  };

  const batch = (target: string, label: string, variant: "destructive" | "success" | "default") =>
    async () => {
      const keysArr = [...sel.sel];
      const ok = await confirm({
        title: `批量${label}`,
        body: (
          <p>
            对已选 <b>{keysArr.length}</b> 条 agent 决策执行「{label}」？
          </p>
        ),
        okLabel: `${label} ${keysArr.length} 条`,
        okVariant: variant,
      });
      if (!ok) return;
      if (await promoteBatch(keysArr, target, label)) {
        sel.clear();
        load(false);
        onMutated();
      }
    };

  return (
    <div>
      <ViewHead
        title={`🤖 agent · ${BUCKET_ZH[bucket]}`}
        count={fmtN(rows.length) + (hasMore ? "+" : "")}
        desc={DESC[bucket]}
      />
      <BatchBar
        selected={sel.selected}
        visible={rows.length}
        allChecked={sel.allChecked}
        indeterminate={sel.indeterminate}
        onToggleAll={sel.toggleAll}
        actions={
          <>
            <Button
              size="sm"
              variant={primary.variant === "destructive" ? "destructive" : "default"}
              className={primary.variant === "success" ? "bg-success text-success-foreground hover:bg-success/90" : undefined}
              onClick={batch(primary.target, `批量${primary.label}`, primary.variant)}
            >
              批量{primary.label}
            </Button>
            {bucket !== "whitelist" && (
              <Button size="sm" variant="outline" className="text-success" onClick={batch("whitelist", "加白", "success")}>
                批量加白
              </Button>
            )}
            {bucket !== "blacklist" && (
              <Button size="sm" variant="outline" className="text-destructive" onClick={batch("blacklist", "拉黑", "destructive")}>
                批量拉黑
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={batch("requeue", "退回", "default")}>
              批量退回
            </Button>
            <Button size="sm" variant="ghost" onClick={batch("reject", "拒绝", "default")}>
              批量拒绝
            </Button>
            <Button size="sm" variant="ghost" onClick={sel.clear}>
              清空选择
            </Button>
          </>
        }
      />
      {rows.length === 0 ? (
        <EmptyState>{BUCKET_ZH[bucket]}桶当前为空。agent 每 15 分钟自动扫待审队列。</EmptyState>
      ) : (
        <ListShell>
          {rows.map((a, i) => {
            const label = a.agent_label || "uncertain";
            const signals = jsonArr(a.agent_signals);
            const reasons = jsonArr(a.agent_reasons);
            let ev: Record<string, unknown> = {};
            try {
              ev = JSON.parse(a.agent_evidence || "{}") || {};
            } catch {}
            const evChips: string[] = [];
            if (ev.account_age_days != null) evChips.push(`账龄 ${ev.account_age_days}d`);
            if (ev.follower_count != null) evChips.push(`粉丝 ${fmtN(ev.follower_count as number)}`);
            if (ev.posting_rate_per_day != null) evChips.push(`日发帖 ${ev.posting_rate_per_day}`);
            if (ev.reply_offtopic_ratio != null)
              evChips.push(`回复跑题率 ${Math.round((ev.reply_offtopic_ratio as number) * 100)}%`);
            return (
              <AccountRow
                key={rowKey(a)}
                a={a}
                label={{ text: verdictZh(label), tone: VERDICTS[label]?.tone || "muted" }}
                selected={sel.sel.has(rowKey(a))}
                onToggle={(shift) => sel.toggle(i, shift)}
                confidence={Math.round((a.agent_confidence || 0) * 100)}
                subExtra={<span>· agent 决策 {ago(a.agent_at || a.last_scored)}</span>}
                below={
                  (signals.length > 0 || reasons.length > 0 || evChips.length > 0) && (
                    <div className="mt-1.5 space-y-1.5">
                      {signals.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {signals.map((s, j) => (
                            <span key={j} className="rounded border border-violet/30 bg-violet/10 px-1.5 py-px font-mono text-[10.5px] font-semibold text-violet">
                              {s}
                            </span>
                          ))}
                        </div>
                      )}
                      {reasons.length > 0 && (
                        <div className="flex flex-wrap gap-x-2 text-[11.5px] text-muted-foreground">
                          {reasons.slice(0, 4).map((r, j) => (
                            <span key={j}>· {r}</span>
                          ))}
                        </div>
                      )}
                      {evChips.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {evChips.map((c, j) => (
                            <span key={j} className="rounded border bg-card px-1.5 py-px text-[11px] tabular-nums text-muted-foreground">
                              {c}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                }
                actions={
                  <>
                    <Button
                      size="sm"
                      variant={primary.variant === "destructive" ? "destructive" : "default"}
                      className={primary.variant === "success" ? "bg-success text-success-foreground hover:bg-success/90" : undefined}
                      onClick={() => promoteOne(a, primary.target)}
                    >
                      {primary.label}
                    </Button>
                    {bucket !== "whitelist" && (
                      <Button size="sm" variant="outline" className="text-success" onClick={() => promoteOne(a, "whitelist")}>
                        加白
                      </Button>
                    )}
                    {bucket !== "blacklist" && (
                      <Button size="sm" variant="outline" className="text-destructive" onClick={() => promoteOne(a, "blacklist")}>
                        拉黑
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => promoteOne(a, "requeue")}>
                      退回
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => promoteOne(a, "reject")}>
                      拒绝
                    </Button>
                  </>
                }
              />
            );
          })}
        </ListShell>
      )}
      <MoreFoot hasMore={hasMore} onMore={() => load(true)} text={`已加载 ${fmtN(rows.length)} 条${hasMore ? "" : "（全部）"}`} />
    </div>
  );
}
