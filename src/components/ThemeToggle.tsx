"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useI18n } from "@/lib/i18n";
import type { Theme } from "@/lib/theme";

// Le thème vit dans la classe .dark de <html> (posée avant l'affichage par THEME_INIT_SCRIPT).
function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function subscribe(onChange: () => void) {
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}

const getTheme = (): Theme =>
  document.documentElement.classList.contains("dark") ? "dark" : "light";
// Le serveur ne connaît pas le thème : null jusqu'à l'hydratation
const getServerTheme = () => null;

export default function ThemeToggle({ className = "" }: { className?: string }) {
  const { lang } = useI18n();
  const theme = useSyncExternalStore(subscribe, getTheme, getServerTheme);

  // Suit le thème du système tant que l'utilisateur n'a pas fait de choix
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      try {
        if (localStorage.getItem("theme")) return;
      } catch {}
      applyTheme(e.matches ? "dark" : "light");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      localStorage.setItem("theme", next);
    } catch {}
  }

  const label =
    theme === "dark"
      ? lang === "ar" ? "الوضع الفاتح" : "Mode clair"
      : lang === "ar" ? "الوضع الداكن" : "Mode sombre";

  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface text-sm text-muted transition hover:text-foreground ${className}`}
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}
