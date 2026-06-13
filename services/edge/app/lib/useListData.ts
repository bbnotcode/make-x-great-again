import { useCallback, useEffect, useRef, useState } from "react";
import { type Account, AuthError, type ListResult } from "./adminApi";

type Fetcher = (cursor: number | null, search: string, sort: string) => Promise<ListResult>;

/** Paginated, searchable, sortable list loader shared by the blacklist /
 *  whitelist tabs. Keeps cursor in a ref so loadMore never races stale state. */
export function useListData(fetcher: Fetcher, initialSort: string, onAuth: () => void) {
  const [list, setList] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState(initialSort);
  const cursor = useRef<number | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(
    async (more: boolean, s: string, so: string) => {
      setLoading(true);
      try {
        const j = await fetcher(more ? cursor.current : null, s, so);
        cursor.current = j.nextBefore;
        setHasMore(!!j.nextBefore);
        setList((prev) => (more ? prev.concat(j.list) : j.list));
        if (j.appliedFilters?.sort) setSort(j.appliedFilters.sort);
      } catch (e) {
        if (e instanceof AuthError) onAuth();
      } finally {
        setLoading(false);
      }
    },
    [fetcher, onAuth],
  );

  useEffect(() => {
    load(false, "", initialSort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runSearch = (s: string) => {
    setSearch(s);
    load(false, s, sort);
  };
  const changeSort = (so: string) => {
    setSort(so);
    load(false, search, so);
  };
  const reload = () => load(false, search, sort);
  const loadMore = () => load(true, search, sort);

  return { list, loading, search, sort, hasMore, runSearch, changeSort, reload, loadMore };
}
