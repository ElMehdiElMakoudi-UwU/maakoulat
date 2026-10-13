// Objectifs vendeurs suggérés + tendance du mois en cours (CA HT).
//
// • CA attendu du mois M (à partir des mois PRÉCÉDENTS uniquement) :
//     – niveau récent = moyenne pondérée des 3 derniers mois avec ventes (poids 3/2/1) ;
//     – tendance = régression linéaire sur les 6 derniers mois avec ventes (≥ 3 mois),
//       projetée sur M et bornée à ±20 % du niveau récent ;
//     – attendu = ½ niveau + ½ tendance ;
//     – saisonnalité (si l'historique remonte à M−12) : CA(M−12) ÷ moyenne(M−15..M−13),
//       borné à [0,75 ; 1,30].
// • Paliers suggérés : attendu × 1,00 / 1,10 / 1,20, arrondis à 5 000 DH.
//   Primes : celles des derniers paliers du vendeur, sinon 400 / 900 / 1 800.
// • Tendance du mois : CA HT saisi ÷ jours couverts (jusqu'à la dernière saisie) × jours du mois.

import { shiftMonth } from "@/lib/productInsights";

interface SaleLike { sale_date: string; quantity: number; sale_price: number }

export const TIER_STEPS = [1, 1.1, 1.2];
export const DEFAULT_BONUSES = [400, 900, 1800];
const ROUND_TO = 5000;
const FLAT_BAND = 0.03; // ±3 % = stable

export type Direction = "up" | "down" | "flat";

export function monthlyCa(sales: SaleLike[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of sales) {
    const m = s.sale_date.slice(0, 7);
    map.set(m, (map.get(m) ?? 0) + Number(s.quantity) * Number(s.sale_price));
  }
  return map;
}

export interface TargetSuggestion {
  expected: number;
  level: number; // moyenne pondérée récente
  trendPct: number | null; // pente mensuelle en % du niveau
  seasonal: number | null; // coefficient saisonnier appliqué
  basis: { month: string; ca: number }[]; // mois utilisés (du plus ancien au plus récent)
  tiers: { threshold: number; bonus: number }[];
}

export function suggestTargets(
  history: Map<string, number>,
  month: string,
  bonuses: number[] = DEFAULT_BONUSES
): TargetSuggestion | null {
  const basis: { month: string; ca: number; idx: number }[] = [];
  for (let i = 1; i <= 6; i++) {
    const m = shiftMonth(month, -i);
    const ca = history.get(m) ?? 0;
    if (ca > 0) basis.unshift({ month: m, ca, idx: -i });
  }
  if (!basis.length) return null;

  const recent = basis.slice(-3).reverse(); // plus récent d'abord
  const w = [3, 2, 1].slice(0, recent.length);
  const level = recent.reduce((s, b, i) => s + b.ca * w[i], 0) / w.reduce((a, b) => a + b, 0);

  let expected = level;
  let trendPct: number | null = null;
  if (basis.length >= 3) {
    const n = basis.length;
    const mx = basis.reduce((s, b) => s + b.idx, 0) / n;
    const my = basis.reduce((s, b) => s + b.ca, 0) / n;
    const sxx = basis.reduce((s, b) => s + (b.idx - mx) ** 2, 0);
    const slope = sxx ? basis.reduce((s, b) => s + (b.idx - mx) * (b.ca - my), 0) / sxx : 0;
    const predicted = Math.min(level * 1.2, Math.max(level * 0.8, my + slope * (0 - mx)));
    expected = (level + predicted) / 2;
    trendPct = level ? slope / level : null;
  }

  let seasonal: number | null = null;
  const lastYear = history.get(shiftMonth(month, -12)) ?? 0;
  const before = [13, 14, 15].map((k) => history.get(shiftMonth(month, -k)) ?? 0).filter((v) => v > 0);
  if (lastYear > 0 && before.length >= 2) {
    const avg = before.reduce((a, b) => a + b, 0) / before.length;
    seasonal = Math.min(1.3, Math.max(0.75, lastYear / avg));
    expected *= seasonal;
  }

  const thresholds: number[] = [];
  for (const step of TIER_STEPS) {
    let v = Math.max(ROUND_TO, Math.round((expected * step) / ROUND_TO) * ROUND_TO);
    if (thresholds.length && v <= thresholds[thresholds.length - 1]) v = thresholds[thresholds.length - 1] + ROUND_TO;
    thresholds.push(v);
  }
  const b = bonuses.length >= TIER_STEPS.length ? bonuses : DEFAULT_BONUSES;
  return {
    expected,
    level,
    trendPct,
    seasonal,
    basis: basis.map(({ month: m, ca }) => ({ month: m, ca })),
    tiers: thresholds.map((threshold, i) => ({ threshold, bonus: b[i] })),
  };
}

export interface MonthPace {
  actual: number; // CA HT saisi sur le mois
  lastDate: string | null; // dernière date de vente saisie
  coveredDays: number;
  daysInMonth: number;
  complete: boolean; // mois terminé
  projected: number | null; // fin de mois estimée
  reference: number | null; // base de comparaison (attendu, sinon mois précédent)
  deltaPct: number | null;
  direction: Direction | null;
}

export function monthPace(
  monthSales: SaleLike[],
  month: string,
  todayStr: string,
  reference: number | null
): MonthPace {
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const actual = monthSales.reduce((s, x) => s + Number(x.quantity) * Number(x.sale_price), 0);
  const lastDate = monthSales.reduce<string | null>((d, x) => (!d || x.sale_date > d ? x.sale_date : d), null);
  const complete = todayStr.slice(0, 7) > month;
  const coveredDays = complete ? daysInMonth : lastDate ? Number(lastDate.slice(8, 10)) : 0;
  const projected = complete ? actual : coveredDays ? (actual / coveredDays) * daysInMonth : null;
  const deltaPct = projected !== null && reference ? projected / reference - 1 : null;
  const direction: Direction | null =
    deltaPct === null ? null : deltaPct > FLAT_BAND ? "up" : deltaPct < -FLAT_BAND ? "down" : "flat";
  return { actual, lastDate, coveredDays, daysInMonth, complete, projected, reference, deltaPct, direction };
}
