import { useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";

function readTheme(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage.getItem("edonism-theme");
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      const isDark = theme === "dark" || (theme === "system" && query.matches);
      document.documentElement.classList.toggle("dark", isDark);
    };

    update();
    try { window.localStorage.setItem("edonism-theme", theme); } catch { /* storage unavailable */ }
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [theme]);

  return { theme, setTheme };
}
