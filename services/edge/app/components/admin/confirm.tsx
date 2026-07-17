import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Variant = "default" | "destructive" | "success";
interface ConfirmOpts {
  title: string;
  body?: React.ReactNode;
  okLabel?: string;
  cancelLabel?: string;
  okVariant?: Variant;
}

const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ConfirmOpts>({ title: "" });
  const resolver = useRef<(v: boolean) => void>(() => {});

  const confirm = useCallback((o: ConfirmOpts) => {
    setOpts(o);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (v: boolean) => {
    setOpen(false);
    resolver.current(v);
  };

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Dialog open={open} onOpenChange={(o) => !o && close(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{opts.title}</DialogTitle>
            {opts.body && (
              <DialogDescription asChild>
                <div className="space-y-1.5 text-[13px] leading-relaxed">{opts.body}</div>
              </DialogDescription>
            )}
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => close(false)}>
              {opts.cancelLabel || "取消"}
            </Button>
            <Button
              size="sm"
              variant={opts.okVariant === "destructive" ? "destructive" : "default"}
              className={
                opts.okVariant === "success"
                  ? "bg-success text-success-foreground hover:bg-success/90"
                  : undefined
              }
              onClick={() => close(true)}
              autoFocus
            >
              {opts.okLabel || "确认"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmCtx.Provider>
  );
}
