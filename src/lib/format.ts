import type { Lang } from "./i18n";

export function fmtMoney(n: number, lang: Lang = "fr"): string {
  const v = Number.isFinite(n) ? n : 0;
  const formatted = new Intl.NumberFormat(lang === "ar" ? "ar-MA" : "fr-MA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(v);
  return `${formatted} ${lang === "ar" ? "درهم" : "DH"}`;
}

export function fmtNum(n: number, lang: Lang = "fr"): string {
  const v = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat(lang === "ar" ? "ar-MA" : "fr-MA", {
    maximumFractionDigits: 2,
  }).format(v);
}

export function fmtPct(n: number, lang: Lang = "fr"): string {
  const v = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat(lang === "ar" ? "ar-MA" : "fr-MA", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  }).format(v);
}

/** Mois courant au format YYYY-MM */
export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Date du jour au format YYYY-MM-DD */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** Bornes [début, fin[ d'un mois YYYY-MM pour filtrer les dates */
export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const nextM = m === 12 ? 1 : m + 1;
  const nextY = m === 12 ? y + 1 : y;
  const end = `${nextY}-${String(nextM).padStart(2, "0")}-01`;
  return { start, end };
}

export function monthLabel(month: string, lang: Lang = "fr"): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-MA" : "fr-FR", {
    month: "long",
    year: "numeric",
  }).format(d);
}
