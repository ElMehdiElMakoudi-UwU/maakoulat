// Primes sur CA : paliers (seuil CA HT → prime) fixés par mois et par vendeur.
// Seul le plus haut palier atteint est payé (non cumulatif).

export interface BonusTier {
  id: string;
  month: string; // YYYY-MM
  seller_id: string;
  threshold: number; // CA HT à atteindre
  bonus: number;
}

interface TierLike { threshold: number; bonus: number }
interface SaleLike { seller_id: string; quantity: number; sale_price: number; sale_date?: string }

export function bonusFor<T extends TierLike>(caHt: number, tiers: T[]): { bonus: number; reached: T | null; next: T | null } {
  const sorted = [...tiers].sort((a, b) => Number(a.threshold) - Number(b.threshold));
  let reached: T | null = null;
  let next: T | null = null;
  for (const t of sorted) {
    if (caHt >= Number(t.threshold)) reached = t;
    else { next = t; break; }
  }
  return { bonus: reached ? Number(reached.bonus) : 0, reached, next };
}

/** CA HT par vendeur sur l'ensemble de ventes fourni. */
export function caHtBySeller(sales: SaleLike[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of sales) map.set(s.seller_id, (map.get(s.seller_id) ?? 0) + Number(s.quantity) * Number(s.sale_price));
  return map;
}

/** Total des primes d'un mois : ventes de CE mois + paliers de CE mois. */
export function totalBonuses(monthSales: SaleLike[], monthTiers: (TierLike & { seller_id: string })[]): number {
  const ca = caHtBySeller(monthSales);
  const bySeller = new Map<string, TierLike[]>();
  for (const t of monthTiers) bySeller.set(t.seller_id, [...(bySeller.get(t.seller_id) ?? []), t]);
  let total = 0;
  for (const [sellerId, tiers] of bySeller) total += bonusFor(ca.get(sellerId) ?? 0, tiers).bonus;
  return total;
}
