import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api, AuthError, type Rule } from "@/lib/adminApi";
import { ago, fmtN } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useConfirm } from "./confirm";
import { EmptyState } from "./MoreFoot";
import { ViewHead } from "./ViewHead";

const FIELD = [
  { value: "any", label: "任一字段" },
  { value: "handle", label: "Handle" },
  { value: "display_name", label: "显示名" },
  { value: "bio", label: "简介 Bio" },
  { value: "tweet", label: "推文内容" },
];
const ACTION = [
  { value: "blacklist", label: "拉黑 — 直接进公榜" },
  { value: "whitelist", label: "白名单 — 永不再扫" },
  { value: "reject", label: "驳回 — 不公开" },
];
const VERDICT = [
  { value: "spam", label: "垃圾营销" },
  { value: "porn_bot", label: "色情广告号" },
  { value: "likely_spam", label: "疑似垃圾" },
  { value: "uncertain", label: "不确定" },
  { value: "legit", label: "正常账号" },
];
const labelOf = (arr: { value: string; label: string }[], v: string) =>
  arr.find((o) => o.value === v)?.label || v;

function AddRuleDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [pattern, setPattern] = useState("");
  const [field, setField] = useState("any");
  const [action, setAction] = useState("blacklist");
  const [verdict, setVerdict] = useState("spam");
  const [note, setNote] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pattern.trim()) return;
    try {
      const j = await api.ruleCreate({
        pattern: pattern.trim(),
        field,
        action,
        verdict_label: verdict,
        note: note.trim() || undefined,
      });
      if (!j.ok) throw new Error(j.detail || j.error);
      toast.success("已创建 rule#" + j.id);
      setOpen(false);
      setPattern("");
      setNote("");
      onAdded();
    } catch {
      toast.error("创建失败");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={() => setOpen(true)}>
        + 新增规则
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新增关键字规则</DialogTitle>
          <DialogDescription>
            pattern 为字面子串，大小写不敏感。命中 → 跳过 LLM，按 action 落地。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label>关键字 / 子串</Label>
            <Input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="如：约炮、@target_dispatch、电报 @" autoFocus />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>匹配字段</Label>
              <Select value={field} onValueChange={setField}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{FIELD.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>命中动作</Label>
              <Select value={action} onValueChange={setAction}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{ACTION.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>判定标签</Label>
              <Select value={verdict} onValueChange={setVerdict}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{VERDICT.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>备注（仅你可见）</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="比如：色情广告 tg 链路特征" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>取消</Button>
            <Button type="submit" size="sm">创建</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RulesTab({ onAuth, onMutated }: { onAuth: () => void; onMutated: () => void }) {
  const confirm = useConfirm();
  const [rules, setRules] = useState<Rule[]>([]);

  const load = useCallback(async () => {
    try {
      const j = await api.rules();
      setRules(j.rules || []);
    } catch (e) {
      if (e instanceof AuthError) onAuth();
    }
  }, [onAuth]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (r: Rule, enabled: boolean) => {
    try {
      await api.ruleToggle(r.id, enabled);
      load();
    } catch {
      toast.error("操作失败");
    }
  };

  const del = async (r: Rule) => {
    const ok = await confirm({
      title: "删除规则",
      body: <p>确认删除规则 <code className="rounded bg-muted px-1">{r.pattern}</code>？已命中的账号不回滚。</p>,
      okLabel: "删除",
      okVariant: "destructive",
    });
    if (!ok) return;
    try {
      await api.ruleDelete(r.id);
      toast.success("已删除");
      load();
    } catch {
      toast.error("删除失败");
    }
  };

  const applyAll = async () => {
    const ok = await confirm({
      title: "扫所有规则到队列",
      body: <p>用全部启用规则扫一遍当前 auto_pending_review 队列，命中按各自 action 落地。</p>,
      okLabel: "开始扫描",
    });
    if (!ok) return;
    const id = toast.loading("应用规则中…");
    try {
      const j = await api.rulesApply();
      if (!j.ok) throw new Error();
      toast.success(`命中 ${j.matched} 条`, { id });
      load();
      onMutated();
    } catch {
      toast.error("失败", { id });
    }
  };

  return (
    <div>
      <ViewHead
        title="关键字规则"
        count={fmtN(rules.length)}
        desc="规则在 /v1/classify 阶段先于 LLM 匹配。命中 → 跳过 LLM，按 action 落地（默认进公榜）。改规则 ≤30s 全局生效。"
        actions={
          <>
            <Button size="sm" variant="outline" onClick={applyAll}>扫所有规则到队列</Button>
            <AddRuleDialog onAdded={load} />
          </>
        }
      />
      {rules.length === 0 ? (
        <EmptyState>还没有规则。点右上角「+ 新增规则」加第一条。</EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">启用</TableHead>
                <TableHead>规则</TableHead>
                <TableHead className="w-24 text-right">命中</TableHead>
                <TableHead className="w-24">最近</TableHead>
                <TableHead className="w-32 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((r) => {
                const enabled = r.enabled === 1 || r.enabled === true;
                return (
                  <TableRow key={r.id} className={cn(!enabled && "opacity-55")}>
                    <TableCell>
                      <Switch checked={enabled} onCheckedChange={(v) => toggle(r, v)} />
                    </TableCell>
                    <TableCell>
                      <div className="font-mono text-sm font-semibold">{r.pattern}</div>
                      <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                        {labelOf(FIELD, r.field)} · {labelOf(ACTION, r.action).split(" ")[0]} · 判{" "}
                        {labelOf(VERDICT, r.verdict_label)}
                        {r.note && <span className="italic"> · {r.note}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      <span className="text-base font-semibold">{fmtN(r.hit_count || 0)}</span>
                    </TableCell>
                    <TableCell className="text-[11.5px] tabular-nums text-muted-foreground">
                      {r.last_hit_at ? ago(r.last_hit_at) : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => del(r)}>
                          删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
