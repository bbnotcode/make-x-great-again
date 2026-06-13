import { Badge } from "@/components/ui/badge";

/** Unified per-tab header: title + optional count + description + actions. */
export function ViewHead({
  title,
  count,
  desc,
  actions,
}: {
  title: React.ReactNode;
  count?: React.ReactNode;
  desc?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <span>{title}</span>
          {count != null && (
            <Badge variant="secondary" className="font-medium tabular-nums">
              {count}
            </Badge>
          )}
        </div>
        {desc && (
          <p className="mt-1.5 max-w-3xl text-[12.5px] leading-relaxed text-muted-foreground">
            {desc}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
