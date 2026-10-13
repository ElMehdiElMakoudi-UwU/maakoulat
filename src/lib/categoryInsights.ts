import type { DemandModel } from "./demandForecast";
import { sellerSalePrice } from "./format";
import { shiftMonth, WINDOW_DAYS, type InsightTone, type MonthPoint, type Quadrant, type SalesBase, type Summary } from "./productInsights";
import { addDays } from "./supplierDues";
import type { DemandSeason, DemandSeasonPeriod, SellerKind } from "./types";

// Analyse par catégorie : agrégation des fiches produit (90 j, 12 mois), rôle de la
// catégorie dans le catalogue et plan d'action priorisé.
//
// • Taux de marge catégorie = bénéfice HT ÷ CA HT (90 j), pondéré par les volumes réels.
// • Rôle : part du bénéfice (≥ part moyenne d'une catégorie = « forte ») × tendance
//   30 j vs 30 j précédents (≥ −5 % = « tient »).
// • Chaque action porte un impact estimé en DH sur 30 jours quand il est calculable,
//   et une priorité (1 = urgent) qui sert au classement du plan d'action global.

export const NO_CATEGORY = "__none__";
const FORECAST_DAYS = 30;
const SEASON_LOOKAHEAD = 60;
const HIGH_COEF = 1.15;
const LOW_COEF = 0.85;

export type CategoryRole = "pillar" | "rising" | "at_risk" | "marginal";

export interface CategoryAction {
  category: string;
  priority: 1 | 2 | 3;
  tone: InsightTone;
  key: string;
  vars?: Record<string, string | number>;
  impact30: number | null; // gain (ou perte évitée) estimé sur 30 j, DH HT
  products: string[]; // ids des produits concernés
}

export interface CategorySeason {
  name: string;
  start: string;
  end: string;
  coef: number;
}

export interface CategorySummary {
  category: string; // NO_CATEGORY pour les produits sans catégorie
  products: Summary[];
  activeCount: number;
  soldCount: number;
  dormantCount: number;
  qty90: number;
  caHT90: number;
  ca90: number; // TTC
  profit90: number;
  marginRate: number;
  caShare: number;
  profitShare: number;
  profitPerProduct: number; // bénéfice 90 j par produit actif
  trend: number | null;
  lastMonth: MonthPoint;
  prevMonth: MonthPoint;
  monthly: MonthPoint[];
  kindQty: Record<SellerKind, number>;
  quadrants: Record<Quadrant, number>;
  topShare: number; // part du 1er produit dans le bénéfice de la catégorie
  role: CategoryRole;
  rank: number;
  forecast30: { qty: number; profit: number };
  seasons: CategorySeason[];
  actions: CategoryAction[];
}

export interface CategoryReport {
  categories: CategorySummary[];
  actions: CategoryAction[]; // toutes catégories, triées par priorité puis impact
  totalProfit90: number;
  totalCA90: number;
  avgMargin: number;
  lastDataDate: string | null; // dernier jour de vente saisi dans la fenêtre de 90 j
}

export interface CategoryOptions {
  marginFloor: number;
}

function emptyMonth(month: string): MonthPoint {
  return { month, qty: 0, ca: 0, profit: 0 };
}

export function buildCategoryReport(
  base: SalesBase,
  model: DemandModel,
  seasons: DemandSeason[],
  periods: DemandSeasonPeriod[],
  opts: CategoryOptions
): CategoryReport {
  const today = base.today;
  const d30 = addDays(today, -30);
  const d60 = addDays(today, -60);
  const iLast = base.windowDates.findIndex((d) => d >= d30);
  const iPrev = base.windowDates.findIndex((d) => d >= d60);
  const coveredIn = (a: number, b: number) => base.covered.slice(a, b).filter(Boolean).length;
  const trendOk = coveredIn(iLast, WINDOW_DAYS) >= 10 && coveredIn(iPrev, iLast) >= 10;
  const lastM = shiftMonth(today.slice(0, 7), -1);
  const prevM = shiftMonth(today.slice(0, 7), -2);
  const fEnd = addDays(today, FORECAST_DAYS - 1);

  const groups = new Map<string, Summary[]>();
  for (const s of base.summaries) {
    const c = s.product.category?.trim() || NO_CATEGORY;
    const arr = groups.get(c) ?? [];
    arr.push(s);
    groups.set(c, arr);
  }

  const raw = [...groups.entries()].map(([category, products]) => {
    const monthly = base.months.map(emptyMonth);
    const kindQty: Record<SellerKind, number> = { retail: 0, traiteur: 0 };
    const quadrants: Record<Quadrant, number> = { star: 0, traffic: 0, potential: 0, review: 0, dormant: 0 };
    let qty90 = 0;
    let caHT90 = 0;
    let ca90 = 0;
    let profit90 = 0;
    let l30 = 0;
    let p30 = 0;
    let fQty = 0;
    let fProfit = 0;
    for (const s of products) {
      const p = s.product;
      const kq = base.kindQty90.get(p.id) ?? { retail: 0, traiteur: 0 };
      kindQty.retail += kq.retail;
      kindQty.traiteur += kq.traiteur;
      quadrants[s.quadrant]++;
      qty90 += s.qty90;
      ca90 += s.ca90;
      caHT90 += kq.retail * p.sale_price + kq.traiteur * sellerSalePrice(p, "traiteur");
      profit90 += s.profit90;
      const mon = base.monthly.get(p.id);
      if (mon) mon.forEach((m, i) => {
        monthly[i].qty += m.qty;
        monthly[i].ca += m.ca;
        monthly[i].profit += m.profit;
      });
      const arr = base.daily.get(p.id);
      if (arr) for (let i = iPrev; i < WINDOW_DAYS; i++) {
        if (i >= iLast) l30 += arr[i];
        else p30 += arr[i];
      }
      const f = model.forecast(p.id, today, fEnd);
      fQty += f.qty;
      fProfit += f.byKind.retail * s.unitMargin + f.byKind.traiteur * (sellerSalePrice(p, "traiteur") - p.purchase_price);
    }
    const top = products.reduce((a, s) => Math.max(a, s.profit90), 0);
    const pick = (m: string) => monthly[base.months.indexOf(m)] ?? emptyMonth(m);
    return {
      category,
      qtyLast30: l30,
      qtyPrev30: p30,
      products: [...products].sort((a, b) => b.profit90 - a.profit90),
      activeCount: products.length,
      soldCount: products.filter((s) => s.qty90 > 0).length,
      dormantCount: quadrants.dormant,
      qty90,
      caHT90,
      ca90,
      profit90,
      marginRate: caHT90 > 0 ? profit90 / caHT90 : 0,
      profitPerProduct: products.length ? profit90 / products.length : 0,
      trend: trendOk && p30 > 0 ? l30 / p30 - 1 : null,
      lastMonth: pick(lastM),
      prevMonth: pick(prevM),
      monthly,
      kindQty,
      quadrants,
      topShare: profit90 > 0 ? top / profit90 : 0,
      forecast30: { qty: fQty, profit: fProfit },
      seasons: categorySeasons(model, seasons, periods, category, kindQty, today),
    };
  });

  const totalProfit90 = raw.reduce((a, c) => a + Math.max(0, c.profit90), 0);
  const totalCA90 = raw.reduce((a, c) => a + c.ca90, 0);
  const totalCAHT = raw.reduce((a, c) => a + c.caHT90, 0);
  const avgMargin = totalCAHT > 0 ? raw.reduce((a, c) => a + c.profit90, 0) / totalCAHT : 0;
  const totalProducts = raw.reduce((a, c) => a + c.activeCount, 0);
  const avgProfitPerProduct = totalProducts ? totalProfit90 / totalProducts : 0;
  const fairShare = raw.length ? 1 / raw.length : 0;

  const categories: CategorySummary[] = raw
    .sort((a, b) => b.profit90 - a.profit90)
    .map((c, i) => {
      const profitShare = totalProfit90 > 0 ? Math.max(0, c.profit90) / totalProfit90 : 0;
      const strong = profitShare >= fairShare;
      const holding = c.trend === null || c.trend >= -0.05;
      const role: CategoryRole = strong ? (holding ? "pillar" : "at_risk") : holding ? "rising" : "marginal";
      const summary = {
        ...c,
        caShare: totalCA90 > 0 ? c.ca90 / totalCA90 : 0,
        profitShare,
        role,
        rank: i + 1,
        actions: [] as CategoryAction[],
      };
      summary.actions = categoryActions(summary, { avgMargin, avgProfitPerProduct, today, kindQty90: base.kindQty90 }, opts);
      return summary;
    });

  const actions = categories
    .flatMap((c) => c.actions)
    .sort((a, b) => a.priority - b.priority || (b.impact30 ?? 0) - (a.impact30 ?? 0));

  const lastIdx = base.covered.lastIndexOf(true);
  const lastDataDate = lastIdx >= 0 ? base.windowDates[lastIdx] : null;
  return { categories, actions, totalProfit90, totalCA90, avgMargin, lastDataDate };
}

function categorySeasons(
  model: DemandModel,
  seasons: DemandSeason[],
  periods: DemandSeasonPeriod[],
  category: string,
  kindQty: Record<SellerKind, number>,
  today: string
): CategorySeason[] {
  const byId = new Map(seasons.map((s) => [s.id, s]));
  const limit = addDays(today, SEASON_LOOKAHEAD);
  const tot = kindQty.retail + kindQty.traiteur;
  const wR = tot > 0 ? kindQty.retail / tot : 1;
  const cat = category === NO_CATEGORY ? null : category;
  return periods
    .filter((p) => p.end_date >= today && byId.has(p.season_id))
    .map((p) => {
      const s = byId.get(p.season_id)!;
      const coef =
        wR * model.categoryCoef(s.id, cat, "retail").value + (1 - wR) * model.categoryCoef(s.id, cat, "traiteur").value;
      return { name: s.name, start: addDays(p.start_date, -s.lead_days), end: p.end_date, coef };
    })
    .filter((x) => x.start <= limit)
    .sort((a, b) => a.start.localeCompare(b.start));
}

type CatCtx = {
  avgMargin: number;
  avgProfitPerProduct: number;
  today: string;
  kindQty90: SalesBase["kindQty90"];
};

function categoryActions(
  c: Omit<CategorySummary, "actions"> & { qtyLast30: number; qtyPrev30: number },
  ctx: CatCtx,
  opts: CategoryOptions
): CategoryAction[] {
  const out: CategoryAction[] = [];
  const pct = (x: number) => Math.round(x * 100);
  const push = (a: Omit<CategoryAction, "category">) => out.push({ category: c.category, ...a });
  const per30 = 30 / WINDOW_DAYS;
  const names = (xs: Summary[], n = 3) => xs.slice(0, n).map((s) => s.product.name).join(", ");
  // Quantité attendue sur 30 j d'après les 90 derniers jours, pour un type de client
  const base30 = (s: Summary, kind: SellerKind) => (ctx.kindQty90.get(s.product.id)?.[kind] ?? 0) * per30;

  // 1. Produits vendus à perte (retail ou traiteur)
  const losing = c.products.filter(
    (s) => s.unitMargin < 0 || (s.traiteurMargin !== null && s.traiteurMargin < 0 && (base30(s, "traiteur") > 0))
  );
  if (losing.length) {
    const loss = losing.reduce((a, s) => {
      const r = Math.min(0, s.unitMargin) * base30(s, "retail");
      const t = Math.min(0, s.traiteurMargin ?? 0) * base30(s, "traiteur");
      return a - r - t;
    }, 0);
    push({ priority: 1, tone: "bad", key: "ca_act_loss", vars: { n: losing.length, names: names(losing) },
      impact30: loss > 0 ? loss : null, products: losing.map((s) => s.product.id) });
  }

  // 2. Marge de la catégorie sous le plancher ou nettement sous la moyenne
  const thin = c.products.filter((s) => s.qty90 > 0 && s.unitMargin >= 0 && s.marginRate < opts.marginFloor);
  if (thin.length) {
    const gain = thin.reduce((a, s) => {
      const target = s.product.purchase_price / (1 - opts.marginFloor);
      return a + Math.max(0, target - s.product.sale_price) * base30(s, "retail");
    }, 0);
    push({ priority: 1, tone: "warn", key: "ca_act_below_floor",
      vars: { n: thin.length, floor: pct(opts.marginFloor), names: names(thin) },
      impact30: gain > 0 ? gain : null, products: thin.map((s) => s.product.id) });
  } else if (c.caHT90 > 0 && c.marginRate < ctx.avgMargin - 0.05) {
    // Hausse de 3 % sur les produits réguliers de la catégorie, à volume constant
    const gain = c.caHT90 * 0.03 * per30;
    push({ priority: 2, tone: "warn", key: "ca_act_low_margin",
      vars: { margin: pct(c.marginRate), avg: pct(ctx.avgMargin) }, impact30: gain, products: [] });
  }

  // 3. Tendance
  if (c.trend !== null && c.trend <= -0.15) {
    // Bénéfice perdu sur 30 j au bénéfice unitaire moyen de la catégorie
    const lost = c.qty90 > 0 ? (c.profit90 / c.qty90) * (c.qtyPrev30 - c.qtyLast30) : 0;
    const decliners = c.products.filter((s) => s.trend !== null && s.trend <= -0.2).sort((a, b) => (a.trend ?? 0) - (b.trend ?? 0));
    push({ priority: c.profitShare >= 0.15 ? 1 : 2, tone: "warn", key: decliners.length ? "ca_act_decline_products" : "ca_act_decline",
      vars: { pct: pct(-c.trend), names: names(decliners) }, impact30: lost > 0 ? lost : null,
      products: decliners.map((s) => s.product.id) });
  } else if (c.trend !== null && c.trend >= 0.15) {
    push({ priority: 2, tone: "good", key: "ca_act_growth", vars: { pct: pct(c.trend) },
      impact30: null, products: c.products.filter((s) => (s.trend ?? 0) >= 0.2).map((s) => s.product.id) });
  }

  // 4. Saisons : forte demande à venir (stock) / creux (promo)
  const high = c.seasons.find((x) => x.coef >= HIGH_COEF && x.start <= addDays(ctx.today, 45));
  if (high && c.qty90 > 0) {
    push({ priority: 1, tone: "info", key: "ca_act_season_high",
      vars: { season: high.name, pct: pct(high.coef - 1), date: high.start },
      impact30: c.profit90 * per30 * (high.coef - 1), products: [] });
  }
  const low = c.seasons.find((x) => x.coef <= LOW_COEF);
  if (low && c.qty90 > 0) {
    push({ priority: 3, tone: "info", key: "ca_act_season_low",
      vars: { season: low.name, pct: pct(1 - low.coef), date: low.start }, impact30: null, products: [] });
  }

  // 5. Dépendance à un seul produit
  if (c.soldCount >= 3 && c.topShare >= 0.6) {
    push({ priority: 2, tone: "warn", key: "ca_act_concentration",
      vars: { name: c.products[0].product.name, pct: pct(c.topShare) }, impact30: null, products: [c.products[0].product.id] });
  }

  // 6. Assortiment : références dormantes / productivité faible
  const dormant = c.products.filter((s) => s.quadrant === "dormant");
  if (dormant.length && (dormant.length >= 3 || dormant.length / c.activeCount >= 0.3)) {
    push({ priority: 2, tone: "warn", key: "ca_act_prune",
      vars: { n: dormant.length, total: c.activeCount, names: names(dormant) }, impact30: null,
      products: dormant.map((s) => s.product.id) });
  } else if (c.activeCount >= 5 && ctx.avgProfitPerProduct > 0 && c.profitPerProduct < ctx.avgProfitPerProduct * 0.4) {
    push({ priority: 3, tone: "info", key: "ca_act_low_productivity",
      vars: { n: c.activeCount }, impact30: null, products: [] });
  }

  // 7. Produits à fort potentiel à pousser
  const potential = c.products.filter((s) => s.quadrant === "potential").sort((a, b) => b.marginRate - a.marginRate);
  if (potential.length) {
    push({ priority: 3, tone: "info", key: "ca_act_push_potential",
      vars: { n: potential.length, names: names(potential) }, impact30: null, products: potential.map((s) => s.product.id) });
  }

  // 8. Catégorie pilier : ne jamais être en rupture, tester une hausse sur les produits d'appel
  if (c.role === "pillar" && c.profitShare >= 0.2) {
    const flagged = new Set([...losing, ...thin].map((s) => s.product.id));
    const traffic = c.products.filter(
      (s) => s.quadrant === "traffic" && !flagged.has(s.product.id) && (s.trend ?? 0) >= -0.05 && s.sellRate >= 0.5
    );
    const gain = traffic.reduce((a, s) => a + s.product.sale_price * 0.03 * base30(s, "retail"), 0);
    push({ priority: 2, tone: "good", key: traffic.length ? "ca_act_pillar_price" : "ca_act_pillar",
      vars: { pct: pct(c.profitShare), names: names(traffic) }, impact30: gain > 0 ? gain : null,
      products: traffic.map((s) => s.product.id) });
  }

  // 9. Traiteur
  const tot = c.kindQty.retail + c.kindQty.traiteur;
  if (tot > 0) {
    const tr = c.kindQty.traiteur / tot;
    if (tr >= 0.5) {
      push({ priority: 3, tone: "info", key: "ca_act_traiteur_driven", vars: { pct: pct(tr) }, impact30: null, products: [] });
    } else if (tr === 0 && c.products.some((s) => s.product.traiteur_price != null)) {
      push({ priority: 3, tone: "info", key: "ca_act_no_traiteur", vars: {}, impact30: null, products: [] });
    }
  }

  return out;
}
