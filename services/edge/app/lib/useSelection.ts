import { useCallback, useRef, useState } from "react";

/** Selection set keyed by row key, with Shift+click range toggling. `keys`
 *  must be the current ordered list of row keys. */
export function useSelection(keys: string[]) {
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const last = useRef(-1);

  const toggle = useCallback(
    (idx: number, shift: boolean) => {
      setSel((prev) => {
        const next = new Set(prev);
        const willSelect = !next.has(keys[idx]);
        if (shift && last.current >= 0 && last.current !== idx) {
          const lo = Math.min(last.current, idx);
          const hi = Math.max(last.current, idx);
          for (let i = lo; i <= hi; i++) {
            if (willSelect) next.add(keys[i]);
            else next.delete(keys[i]);
          }
        } else if (willSelect) next.add(keys[idx]);
        else next.delete(keys[idx]);
        last.current = idx;
        return next;
      });
    },
    [keys],
  );

  const toggleAll = useCallback(
    (checked: boolean) => {
      last.current = -1;
      setSel(checked ? new Set(keys) : new Set());
    },
    [keys],
  );

  const clear = useCallback(() => {
    last.current = -1;
    setSel(new Set());
  }, []);

  const inView = keys.reduce((n, k) => n + (sel.has(k) ? 1 : 0), 0);
  return {
    sel,
    toggle,
    toggleAll,
    clear,
    selected: sel.size,
    allChecked: keys.length > 0 && inView === keys.length,
    indeterminate: inView > 0 && inView < keys.length,
  };
}
