// =====================================================================
// Récapitulatif TVA : périodes (mois / trimestre) et calculs. Fonctions pures.
// • TVA collectée = Σ ventes HT × taux produit (toutes les ventes, facturées ou non)
// • TVA déductible = factures fournisseurs + charges, montants saisis en TTC :
//   TVA = TTC × taux / (100 + taux)
// • Résultat = collectée − déductible − crédit reporté (> 0 : à payer ; < 0 : crédit)
// =====================================================================

export const VAT_RATES = [0, 7, 10, 14, 20] as const;

export type PeriodMode = "month" | "quarter";

/** Clé de période : 'YYYY-MM' (mois) ou 'YYYY-Tn' (trimestre). */
export function periodKey(month: string, mode: PeriodMode): string {
  if (mode === "month") return month;
  const [y, m] = month.split("-").map(Number);
  return `${y}-T${Math.ceil(m / 3)}`;
}

/** Mois 'YYYY-MM' couverts par une période. */
export function periodMonths(key: string): string[] {
  const q = key.match(/^(\d{4})-T([1-4])$/);
  if (!q) return [key];
  const y = q[1];
  const first = (Number(q[2]) - 1) * 3 + 1;
  return [0, 1, 2].map((i) => `${y}-${String(first + i).padStart(2, "0")}`);
}

/** Période précédente (même granularité). */
export function previousPeriod(key: string): string {
  const q = key.match(/^(\d{4})-T([1-4])$/);
  if (q) {
    const y = Number(q[1]);
    const n = Number(q[2]);
    return n === 1 ? `${y - 1}-T4` : `${y}-T${n - 1}`;
  }
  const [y, m] = key.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Bornes de dates [start, end[ d'une période. */
export function periodRange(key: string): { start: string; end: string } {
  const months = periodMonths(key);
  const [ly, lm] = months[months.length - 1].split("-").map(Number);
  const end = lm === 12 ? `${ly + 1}-01-01` : `${ly}-${String(lm + 1).padStart(2, "0")}-01`;
  return { start: `${months[0]}-01`, end };
}

/** TVA incluse dans un montant TTC. */
export function vatFromTTC(ttcAmount: number, rate: number | null | undefined): number {
  const r = Number(rate) || 0;
  if (r <= 0) return 0;
  return (Number(ttcAmount) || 0) * r / (100 + r);
}

export interface RateLine {
  rate: number;
  base: number; // HT
  vat: number;
}

/** Ventilation par taux à partir de lignes HT. */
export function byRate(lines: { ht: number; rate: number }[]): RateLine[] {
  const m = new Map<number, RateLine>();
  for (const l of lines) {
    const cur = m.get(l.rate) ?? { rate: l.rate, base: 0, vat: 0 };
    cur.base += l.ht;
    cur.vat += l.ht * l.rate / 100;
    m.set(l.rate, cur);
  }
  return [...m.values()].sort((a, b) => b.rate - a.rate);
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
