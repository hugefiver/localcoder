import { Moon, Sun } from "@phosphor-icons/react";
import { useTheme } from "next-themes";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";

/**
 * Simple light/dark toggle.
 * Uses next-themes and Tailwind's `.dark` class variant.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  const isDark = useMemo(() => resolvedTheme === "dark", [resolvedTheme]);

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="fixed right-4 top-4 z-50"
      aria-label={isDark ? "切换到亮色模式" : "切换到暗色模式"}
      title={isDark ? "切换到亮色模式" : "切换到暗色模式"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun size={18} weight="bold" /> : <Moon size={18} weight="bold" />}
    </Button>
  );
}
