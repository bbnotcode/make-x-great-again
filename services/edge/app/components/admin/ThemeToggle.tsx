import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";

export function ThemeToggle() {
  const { theme, cycle } = useTheme();
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycle}
      aria-label="切换亮/暗主题（auto → light → dark）"
      title="auto → light → dark"
      className="size-8 text-muted-foreground"
    >
      <Icon className="size-4" />
    </Button>
  );
}
