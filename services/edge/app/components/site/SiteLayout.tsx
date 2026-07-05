import { Database, List } from "lucide-react";
import { Link } from "react-router-dom";
import { ThemeToggle } from "@/components/admin/ThemeToggle";
import { GhIcon } from "@/components/site/FeedAvatar";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

function NavLink({
  to,
  external,
  active,
  children,
}: {
  to: string;
  external?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  const cls = cn(
    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
    active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
  );
  return external ? (
    <a href={to} target="_blank" rel="noopener" className={cls}>
      {children}
    </a>
  ) : (
    <Link to={to} className={cls}>
      {children}
    </Link>
  );
}

export function SiteLayout({
  current,
  children,
}: {
  current: "home" | "list";
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[1080px] px-6 sm:px-7">
      <header className="sticky top-0 z-30 -mx-6 flex items-center justify-between border-b border-border/60 px-6 py-4 backdrop-blur-md transition-colors supports-[backdrop-filter]:bg-background/70 sm:-mx-7 sm:px-7">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight" aria-label={BRAND.name + " 首页"}>
          <img src="/mxga-mark.png" alt="" width={32} height={32} className="size-8" />
          <span>{BRAND.acronym}</span>
        </Link>
        <div className="flex items-center gap-1">
          <nav className="flex items-center" aria-label="主导航">
            <NavLink to="/list" active={current === "list"}>
              <List className="size-3.5" /> 名单
            </NavLink>
            <NavLink to={BRAND.repo + "/tree/main/data"} external>
              <Database className="size-3.5" /> 公开数据
            </NavLink>
            <NavLink to={BRAND.repo} external>
              <GhIcon className="size-3.5" /> GitHub
            </NavLink>
          </nav>
          <ThemeToggle />
        </div>
      </header>

      <main>{children}</main>

      <footer className="mt-16 flex flex-wrap items-center justify-between gap-3 border-t py-6 text-[12.5px] text-muted-foreground">
        <span>
          {BRAND.owner} · {BRAND.license}
        </span>
        <span className="flex items-center gap-2">
          <a href={BRAND.repo} className="hover:text-foreground">仓库</a> ·
          <a href={BRAND.governance} className="hover:text-foreground">治理</a> ·
          <a href={BRAND.privacy} className="hover:text-foreground">隐私</a> ·
          <a href={BRAND.issues} className="hover:text-foreground">反馈</a>
        </span>
      </footer>
    </div>
  );
}
