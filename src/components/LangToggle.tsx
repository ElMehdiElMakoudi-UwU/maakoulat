"use client";

import { useI18n } from "@/lib/i18n";

export default function LangToggle({ className = "" }: { className?: string }) {
  const { lang, setLang } = useI18n();
  return (
    <div className={`inline-flex rounded-lg border border-border bg-surface p-0.5 text-sm ${className}`}>
      <button
        onClick={() => setLang("fr")}
        className={`rounded-md px-2.5 py-1 font-medium transition ${
          lang === "fr" ? "bg-primary text-primary-fg" : "text-muted hover:text-foreground"
        }`}
      >
        FR
      </button>
      <button
        onClick={() => setLang("ar")}
        className={`rounded-md px-2.5 py-1 font-medium transition ${
          lang === "ar" ? "bg-primary text-primary-fg" : "text-muted hover:text-foreground"
        }`}
      >
        ع
      </button>
    </div>
  );
}
