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

/**
 * Durée en jours. En arabe, accord du nom avec le nombre :
 * 1 → يوم واحد, 2 → يومان, 3–10 → أيام, 11+ → يومًا.
 */
export function fmtDays(n: number, lang: Lang = "fr"): string {
  const v = Math.abs(Math.round(n));
  if (lang === "fr") return `${v} j`;
  if (v === 1) return "يوم واحد";
  if (v === 2) return "يومان";
  const mod = v % 100;
  return mod >= 3 && mod <= 10 ? `${v} أيام` : `${v} يومًا`;
}

/**
 * Prix de vente TTC à partir d'un prix HT (celui saisi sur la fiche produit)
 * et d'un taux de TVA en pourcentage. Toute vente est valorisée en TTC.
 */
export function ttc(priceHT: number, vatRate: number): number {
  const p = Number(priceHT) || 0;
  const v = Number(vatRate) || 0;
  return p * (1 + v / 100);
}

// Prix de vente HT applicable pour un vendeur donné : les vendeurs "traiteur"
// ont leur propre liste de prix (products.traiteur_price) ; si elle n'est pas
// renseignée pour un produit, le prix retail (sale_price) sert de repli.
export function sellerSalePrice(
  product: { sale_price: number; traiteur_price: number | null },
  sellerKind: "retail" | "traiteur"
): number {
  if (sellerKind === "traiteur" && product.traiteur_price != null) return product.traiteur_price;
  return product.sale_price;
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
