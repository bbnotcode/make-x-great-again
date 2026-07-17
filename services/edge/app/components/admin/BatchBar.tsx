import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

/** Sticky-feeling selection bar: master checkbox + counts on the left, bulk
 *  action buttons on the right (shown only when ≥1 row is selected). */
export function BatchBar({
  selected,
  visible,
  allChecked,
  indeterminate,
  onToggleAll,
  actions,
}: {
  selected: number;
  visible: number;
  allChecked: boolean;
  indeterminate: boolean;
  onToggleAll: (checked: boolean) => void;
  actions: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "mb-3 flex items-center justify-between gap-3 rounded-xl border bg-card px-3.5 py-2.5 shadow-sm transition",
        selected > 0 && "border-ring/40 ring-1 ring-ring/15",
      )}
    >
      <div className="flex cursor-pointer select-none items-center gap-2.5 text-[13px]">
        <Checkbox
          checked={indeterminate ? "indeterminate" : allChecked}
          onCheckedChange={(v) => onToggleAll(v === true)}
          aria-label="全选当前范围"
        />
        <span>
          已选 <b className="tabular-nums">{selected}</b> · 当前{" "}
          <b className="tabular-nums">{visible}</b>
          <span className="ml-1.5 text-[11.5px] text-muted-foreground">（Shift+点可范围多选）</span>
        </span>
      </div>
      {selected > 0 && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
