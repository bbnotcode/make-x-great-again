import { Button } from "@/components/ui/button";

export function MoreFoot({
  hasMore,
  onMore,
  text,
}: {
  hasMore: boolean;
  onMore: () => void;
  text?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-center gap-3 py-4 text-[12.5px] text-muted-foreground">
      {hasMore && (
        <Button variant="outline" size="sm" onClick={onMore}>
          加载更多
        </Button>
      )}
      {text && <span>{text}</span>}
    </div>
  );
}

export function ListShell({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-xl border bg-card shadow-sm">{children}</div>;
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed px-5 py-16 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
