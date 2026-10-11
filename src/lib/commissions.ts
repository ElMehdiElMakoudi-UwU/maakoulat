// Commissions vendeurs : taux (%) par catégorie de produit, appliqué au CA HT.
// Seuls les vendeurs « retail » en touchent (pas le Traiteur).

export interface CommissionRate {
  category: string;
  rate: number; // %
}

interface SellerLike { id: string; kind: string }
interface SaleLike { seller_id: string; product_id: string; quantity: number; sale_price: number }

/** Clé de comparaison d'une catégorie (insensible à la casse et aux espaces). */
export const catKey = (c: string | null | undefined) => (c ?? "").trim().toLowerCase();

export const earnsCommission = (s: { kind: string }) => s.kind === "retail";

export function rateMap(rates: CommissionRate[]): Map<string, number> {
  return new Map(rates.map((r) => [catKey(r.category), Number(r.rate)]));
}

export interface SellerCommission {
  seller_id: string;
  base: number; // CA HT soumis à commission (catégories avec taux > 0)
  commission: number;
  byCategory: { category: string; base: number; rate: number; commission: number }[];
}

/** Commission par vendeur éligible sur l'ensemble de ventes fourni. */
export function commissionsBySeller(
  sales: SaleLike[],
  sellers: SellerLike[],
  categoryOf: (productId: string) => string | null | undefined,
  rates: Map<string, number>
): SellerCommission[] {
  const eligible = new Set(sellers.filter(earnsCommission).map((s) => s.id));
  const acc = new Map<string, Map<string, { category: string; base: number; rate: number }>>();
  for (const s of sales) {
    if (!eligible.has(s.seller_id)) continue;
    const category = (categoryOf(s.product_id) ?? "").trim();
    const rate = rates.get(catKey(category)) ?? 0;
    if (!rate) continue;
    const cats = acc.get(s.seller_id) ?? new Map();
    const cur = cats.get(catKey(category)) ?? { category, base: 0, rate };
    cur.base += Number(s.quantity) * Number(s.sale_price);
    cats.set(catKey(category), cur);
    acc.set(s.seller_id, cats);
  }
  return sellers.filter(earnsCommission).map((sel) => {
    const byCategory = [...(acc.get(sel.id)?.values() ?? [])]
      .map((c) => ({ ...c, commission: (c.base * c.rate) / 100 }))
      .sort((a, b) => b.commission - a.commission);
    return {
      seller_id: sel.id,
      base: byCategory.reduce((s, c) => s + c.base, 0),
      commission: byCategory.reduce((s, c) => s + c.commission, 0),
      byCategory,
    };
  });
}

/** Total des commissions sur l'ensemble de ventes fourni. */
export function totalCommission(
  sales: SaleLike[],
  sellers: SellerLike[],
  categoryOf: (productId: string) => string | null | undefined,
  rates: Map<string, number>
): number {
  return commissionsBySeller(sales, sellers, categoryOf, rates).reduce((s, c) => s + c.commission, 0);
}
