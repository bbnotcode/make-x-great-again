import { createContext, useCallback, useContext, useEffect, useState } from "react";

type Theme = "auto" | "light" | "dark";
const KEY = "mxga_theme";

function read(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    if (t === "light" || t === "dark") return t;
  } catch {}
  return "auto";
}

function apply(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

const ThemeCtx = createContext<{ theme: Theme; cycle: () => void }>({
  theme: "auto",
  cycle: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(read);

  useEffect(() => {
    apply(theme);
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => theme === "auto" && apply("auto");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const cycle = useCallback(() => {
    setTheme((cur) => {
      const next: Theme = cur === "auto" ? "light" : cur === "light" ? "dark" : "auto";
      try {
        if (next === "auto") localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, next);
      } catch {}
      return next;
    });
  }, []);

  return <ThemeCtx.Provider value={{ theme, cycle }}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);
