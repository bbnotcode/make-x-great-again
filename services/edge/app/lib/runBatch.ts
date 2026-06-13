import { toast } from "sonner";
import { BATCH_CHUNK, chunk, type Item, selToItems } from "./adminApi";

/** Run a bulk action over selected keys, chunked at 100, with toast progress.
 *  Returns true if every chunk succeeded. */
export async function runBatch(
  keys: string[],
  label: string,
  call: (items: Item[]) => Promise<{ ok: boolean; error?: string }>,
): Promise<boolean> {
  const chunks = chunk(keys, BATCH_CHUNK);
  const id = toast.loading(`批量${label} 0/${keys.length}`);
  let done = 0;
  for (const slice of chunks) {
    try {
      const j = await call(selToItems(slice));
      if (!j.ok) throw new Error(j.error || "failed");
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
