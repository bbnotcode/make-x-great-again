import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SORT_OPTIONS } from "@/lib/adminApi";

/** Search input + sort select + buttons, shared by blacklist/whitelist tabs.
 *  All controls share one height so the row lines up. */
export function SearchBar({
  placeholder,
  search,
  sort,
  onSearch,
  onSort,
}: {
  placeholder: string;
  search: string;
  sort: string;
  onSearch: (q: string) => void;
  onSort: (s: string) => void;
}) {
  const [draft, setDraft] = useState(search);
  return (
    <form
      className="mb-3 grid grid-cols-1 items-end gap-2.5 sm:grid-cols-[minmax(220px,1fr)_180px_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(draft.trim());
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label className="text-[11.5px] font-normal text-muted-foreground">搜索</Label>
        <Input
          type="search"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          className="h-9"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-[11.5px] font-normal text-muted-foreground">排序</Label>
        <Select value={sort} onValueChange={onSort}>
          <SelectTrigger className="h-9 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((o) => (
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
        {search && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9"
            onClick={() => {
              setDraft("");
              onSearch("");
            }}
          >
            清除
          </Button>
        )}
      </div>
    </form>
  );
}
