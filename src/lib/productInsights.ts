import { dayIndex, type DemandModel } from "./demandForecast";
import { sellerSalePrice, ttc } from "./format";
import { addDays } from "./supplierDues";
import type { DemandSeason, DemandSeasonPeriod, Product, SellerKind } from "./types";

// Analyse produit : marge, ventes, tendance, potentiel, promotions, produits associés.
//
// • Les ventes sont saisies en totaux journaliers (produit × vendeur × jour) : il n'y a
//   pas de ticket de caisse, donc pas d'analyse de panier possible. Les « produits
//   associés » sont ceux dont la PART des ventes du jour évolue avec celle du produit
//   (corrélation des parts : l'effet « jour d'affluence » qui gonfle tout est neutralisé).
// • Un jour « couvert » = un jour où au moins une vente a été saisie (tous produits).
//   Seuls les jours couverts comptent dans les moyennes (jour non saisi ≠ vente nulle).
// • Promotion : remise d = x %. Volume attendu = (1 − d)^élasticité (élasticité constante,
//   estimée sur l'historique des prix si possible, sinon valeur choisie par l'utilisateur).
//   Hausse de volume « point mort » = marge / (marge − prix × d).

export const WINDOW_DAYS = 90;
const FORECAST_DAYS = 30;
const SEASON_LOOKAHEAD = 120;
const MIN_PRICE_POINT_DAYS = 7;
const MIN_COMPLEMENT_DAYS = 8;
const MIN_CORR_DAYS = 14;
const COMPLEMENT_MIN_R = 0.35;
export const DISCOUNT_STEPS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3];

export interface PricedSale {
  product_id: string;
  seller_id: string;
  sale_date: string;
  quantity: number;
  purchase_price: number;
  sale_price: number;
}

export type Quadrant = "star" | "traffic" | "potential" | "review" | "dormant";
export type Abc = "A" | "B" | "C";

export interface MonthPoint {
  month: string; // YYYY-MM
  qty: number;
  ca: number; // TTC
  profit: number; // HT
}

export interface Summary {
  product: Product;
  unitMargin: number; // HT, prix retail
  marginRate: number; // marge / prix de vente HT
  traiteurMargin: number | null;
  qty90: number;
  profit90: number;
  ca90: number;
  lastMonth: MonthPoint;
  prevMonth: MonthPoint;
  mtd: MonthPoint;
  trend: number | null; // variation des ventes : 30 derniers jours vs 30 précédents
  daysSinceLastSale: number | null;
  sellRate: number; // part des jours couverts avec au moins une vente (90 j)
  profitShare: number; // part du bénéfice total (90 j)
  abc: Abc | null;
  quadrant: Quadrant;
}

export interface SalesBase {
  today: string;
  windowDates: string[]; // 90 derniers jours (hier inclus), ordre chronologique
  covered: boolean[]; // jour couvert ?
  daily: Map<string, Float64Array>; // quantités journalières par produit (fenêtre)
  dailyTotal: Float64Array;
  months: string[]; // 12 derniers mois (mois courant inclus)
  monthly: Map<string, MonthPoint[]>;
  kindQty90: Map<string, Record<SellerKind, number>>;
  lastSale: Map<string, string>;
  pricePoints: Map<string, Map<number, { qty: number; days: Set<string> }>>; // retail uniquement
  summaries: Summary[];
  medianQty: number;
  medianMargin: number;
}

function monthKey(d: string) {
  return d.slice(0, 7);
}

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function emptyMonth(month: string): MonthPoint {
  return { month, qty: 0, ca: 0, profit: 0 };
}

/** Date de début des ventes à charger pour `buildSalesBase` */
export function salesFetchStart(today: string): string {
  const fromMonths = `${shiftMonth(monthKey(today), -11)}-01`;
  const fromWindow = addDays(today, -2 * WINDOW_DAYS);
  return fromMonths < fromWindow ? fromMonths : fromWindow;
}

export function buildSalesBase(
  products: Product[],
  sales: PricedSale[],
  kindOf: Map<string, SellerKind>,
  today: string
): SalesBase {
  const productById = new Map(products.map((p) => [p.id, p]));
  const startIdx = dayIndex(today) - WINDOW_DAYS;
  const windowDates = Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(today, i - WINDOW_DAYS));
  const covered = new Array<boolean>(WINDOW_DAYS).fill(false);
  const daily = new Map<string, Float64Array>();
  const dailyTotal = new Float64Array(WINDOW_DAYS);
  const curMonth = monthKey(today);
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(curMonth, i - 11));
  const monthPos = new Map(months.map((m, i) => [m, i]));
  const monthly = new Map<string, MonthPoint[]>();
  const kindQty90 = new Map<string, Record<SellerKind, number>>();
  const lastSale = new Map<string, string>();
  const pricePoints = new Map<string, Map<number, { qty: number; days: Set<string> }>>();
  // 30 derniers jours vs 30 précédents (tendance)
  const last30 = new Map<string, number>();
  const prev30 = new Map<string, number>();
  const coveredAll = new Set<string>();
  const d30 = addDays(today, -30);
  const d60 = addDays(today, -60);

  for (const s of sales) {
    if (s.sale_date >= today) continue; // le jour en cours est incomplet
    const qty = Number(s.quantity);
    const product = productById.get(s.product_id);
    coveredAll.add(s.sale_date);
    if (!product || qty === 0) continue;
    const kind = kindOf.get(s.seller_id) ?? "retail";

    const prev = lastSale.get(s.product_id);
    if (!prev || s.sale_date > prev) lastSale.set(s.product_id, s.sale_date);

    const mp = monthPos.get(monthKey(s.sale_date));
    if (mp !== undefined) {
      let arr = monthly.get(s.product_id);
      if (!arr) {
        arr = months.map(emptyMonth);
        monthly.set(s.product_id, arr);
      }
      arr[mp].qty += qty;
      arr[mp].ca += qty * ttc(s.sale_price, product.vat_rate);
      arr[mp].profit += qty * (s.sale_price - s.purchase_price);
    }

    if (s.sale_date >= d30) last30.set(s.product_id, (last30.get(s.product_id) ?? 0) + qty);
    else if (s.sale_date >= d60) prev30.set(s.product_id, (prev30.get(s.product_id) ?? 0) + qty);

    const i = dayIndex(s.sale_date) - startIdx;
    if (i < 0 || i >= WINDOW_DAYS) continue;
    let arr = daily.get(s.product_id);
    if (!arr) {
      arr = new Float64Array(WINDOW_DAYS);
      daily.set(s.product_id, arr);
    }
    arr[i] += qty;
    dailyTotal[i] += qty;
    const kq = kindQty90.get(s.product_id) ?? { retail: 0, traiteur: 0 };
    kq[kind] += qty;
    kindQty90.set(s.product_id, kq);
    if (kind === "retail") {
      let pts = pricePoints.get(s.product_id);
      if (!pts) {
        pts = new Map();
        pricePoints.set(s.product_id, pts);
      }
      const price = Number(s.sale_price);
      const pt = pts.get(price) ?? { qty: 0, days: new Set<string>() };
      pt.qty += qty;
      pt.days.add(s.sale_date);
      pts.set(price, pt);
    }
  }
  for (let i = 0; i < WINDOW_DAYS; i++) covered[i] = coveredAll.has(windowDates[i]);
  const coveredCount = covered.filter(Boolean).length;
  // La tendance n'a de sens que si les deux périodes de 30 jours ont été saisies
  const coveredLast30 = [...coveredAll].filter((d) => d >= d30 && d < today).length;
  const coveredPrev30 = [...coveredAll].filter((d) => d >= d60 && d < d30).length;

  const base: Omit<SalesBase, "summaries" | "medianQty" | "medianMargin"> = {
    today,
    windowDates,
    covered,
    daily,
    dailyTotal,
    months,
    monthly,
    kindQty90,
    lastSale,
    pricePoints,
  };

  const lastM = shiftMonth(curMonth, -1);
  const prevM = shiftMonth(curMonth, -2);
  const raw = products
    .filter((p) => p.active)
    .map((p) => {
      const mon = monthly.get(p.id);
      const pick = (m: string) => mon?.[monthPos.get(m)!] ?? emptyMonth(m);
      const arr = daily.get(p.id);
      let qty90 = 0;
      let soldDays = 0;
      if (arr) for (let i = 0; i < WINDOW_DAYS; i++) {
        qty90 += arr[i];
        if (arr[i] > 0) soldDays++;
      }
      const kq = kindQty90.get(p.id) ?? { retail: 0, traiteur: 0 };
      const mR = p.sale_price - p.purchase_price;
      const mT = sellerSalePrice(p, "traiteur") - p.purchase_price;
      const profit90 = kq.retail * mR + kq.traiteur * mT;
      const ca90 =
        kq.retail * ttc(p.sale_price, p.vat_rate) + kq.traiteur * ttc(sellerSalePrice(p, "traiteur"), p.vat_rate);
      const l30 = last30.get(p.id) ?? 0;
      const p30 = prev30.get(p.id) ?? 0;
      const last = lastSale.get(p.id);
      return {
        product: p,
        unitMargin: mR,
        marginRate: p.sale_price > 0 ? mR / p.sale_price : 0,
        traiteurMargin: p.traiteur_price != null ? mT : null,
        qty90,
        profit90,
        ca90,
        lastMonth: pick(lastM),
        prevMonth: pick(prevM),
        mtd: pick(curMonth),
        trend: coveredLast30 >= 10 && coveredPrev30 >= 10 && p30 > 0 ? l30 / p30 - 1 : null,
        daysSinceLastSale: last ? dayIndex(today) - dayIndex(last) : null,
        sellRate: coveredCount ? soldDays / coveredCount : 0,
      };
    });

  const sold = raw.filter((r) => r.qty90 > 0);
  const medianQty = median(sold.map((r) => r.qty90));
  const medianMargin = median(sold.map((r) => r.marginRate));
  const totalProfit = sold.reduce((a, r) => a + Math.max(0, r.profit90), 0);

  // Classement ABC sur la contribution au bénéfice (80 % / 95 %)
  const abcOf = new Map<string, Abc>();
  let cum = 0;
  for (const r of [...sold].sort((a, b) => b.profit90 - a.profit90)) {
    const share = totalProfit > 0 ? Math.max(0, r.profit90) / totalProfit : 0;
    abcOf.set(r.product.id, cum < 0.8 ? "A" : cum < 0.95 ? "B" : "C");
    cum += share;
  }

  const summaries: Summary[] = raw.map((r) => {
    let quadrant: Quadrant;
    if (r.qty90 <= 0) quadrant = "dormant";
    else {
      const hiVol = r.qty90 >= medianQty;
      const hiMargin = r.marginRate >= medianMargin;
      quadrant = hiVol ? (hiMargin ? "star" : "traffic") : hiMargin ? "potential" : "review";
    }
    return {
      ...r,
      profitShare: totalProfit > 0 ? Math.max(0, r.profit90) / totalProfit : 0,
      abc: abcOf.get(r.product.id) ?? null,
      quadrant,
    };
  });

  return { ...base, summaries, medianQty, medianMargin };
}

// ---------------------------------------------------------------------
// Analyse détaillée d'un produit
// ---------------------------------------------------------------------

export interface WeekdayPoint {
  weekday: number; // 0 = dimanche
  avg: number;
  days: number;
}

export interface UpcomingSeason {
  name: string;
  start: string;
  end: string;
  coef: number;
}

export interface Complement {
  product: Product;
  r: number;
  qty90: number;
  marginRate: number;
}

export interface Scenario {
  discount: number;
  priceTTC: number;
  marginRate: number;
  breakEvenUplift: number; // multiplicateur de volume nécessaire pour garder le même bénéfice
  expectedUplift: number; // multiplicateur attendu (élasticité)
  profitChange: number; // variation de bénéfice attendue (en %)
  allowed: boolean; // marge après remise ≥ plancher
}

export type PromoWhen = "avoid_high_season" | "low_season" | "now" | "weak_days" | "none";

export interface PromoPlan {
  discount: number | null; // remise recommandée (null = pas de promo)
  reason: "profitable" | "clearance" | "revive" | "no_room" | "not_needed" | "high_season";
  when: PromoWhen;
  season: UpcomingSeason | null;
  weakDays: number[];
  durationDays: number;
  maxDiscount: number;
  elasticity: number;
  elasticitySource: "estimated" | "assumed";
  scenarios: Scenario[];
}

export interface Bundle {
  with: Product;
  discount: number;
  priceTTC: number;
  regularTTC: number;
  marginRate: number;
}

export interface PriceAdvice {
  kind: "raise_to_floor" | "test_increase";
  newPriceHT: number;
  pct: number;
  extraProfit30: number; // bénéfice supplémentaire sur 30 j à volume constant
}

export type InsightTone = "good" | "warn" | "bad" | "info";
export interface Insight {
  tone: InsightTone;
  key: string;
  vars?: Record<string, string | number>;
}

export interface ProductAnalysis {
  summary: Summary;
  monthly: MonthPoint[];
  weekdays: WeekdayPoint[];
  kindQty: Record<SellerKind, number>;
  forecast30: { qty: number; profit: number; baselinePerDay: number; avgCoef: number };
  seasons: UpcomingSeason[];
  complements: Complement[];
  upsells: Summary[];
  bundle: Bundle | null;
  promo: PromoPlan;
  priceAdvice: PriceAdvice | null;
  insights: Insight[];
}

export interface AnalysisOptions {
  marginFloor: number; // marge minimale après remise (ex : 0.1)
  elasticity: number; // élasticité supposée (négative) si non estimable
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function weekdayProfile(base: SalesBase, productId: string): WeekdayPoint[] {
  const arr = base.daily.get(productId);
  const sum = new Array(7).fill(0);
  const n = new Array(7).fill(0);
  base.windowDates.forEach((d, i) => {
    if (!base.covered[i]) return;
    const w = weekdayOf(d);
    sum[w] += arr?.[i] ?? 0;
    n[w]++;
  });
  return sum.map((s, w) => ({ weekday: w, avg: n[w] ? s / n[w] : 0, days: n[w] }));
}

/** Élasticité-prix estimée à partir des deux prix de vente les plus observés (retail). */
function estimateElasticity(base: SalesBase, productId: string): number | null {
  const pts = base.pricePoints.get(productId);
  if (!pts) return null;
  const coveredDates = new Set(base.windowDates.filter((_, i) => base.covered[i]));
  const usable = [...pts.entries()]
    .map(([price, v]) => ({ price, days: [...v.days].filter((d) => coveredDates.has(d)).length, qty: v.qty }))
    .filter((x) => x.price > 0 && x.days >= MIN_PRICE_POINT_DAYS)
    .sort((a, b) => b.days - a.days)
    .slice(0, 2);
  if (usable.length < 2) return null;
  const [a, b] = usable;
  if (Math.abs(a.price / b.price - 1) < 0.03) return null;
  // Quantité moyenne par jour où le prix était en vigueur (jours avec vente seulement :
  // approximation, les jours sans vente ne portent pas de prix)
  const qa = a.qty / a.days;
  const qb = b.qty / b.days;
  if (qa <= 0 || qb <= 0) return null;
  const e = Math.log(qa / qb) / Math.log(a.price / b.price);
  // Une élasticité positive traduit surtout d'autres effets (saison, hausse des coûts) : ignorée
  if (!Number.isFinite(e) || e >= -0.2) return null;
  return Math.max(-5, e);
}

function pearson(x: number[], y: number[]): number {
  const n = x.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i];
    my += y[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

/**
 * Ventes journalières « hors affluence » de chaque produit régulier :
 *   quantité du jour ÷ (moyenne du produit × indice d'affluence du jour),
 * l'indice d'affluence étant la médiane, sur tous les produits réguliers, de
 * (quantité du jour ÷ moyenne du produit). La médiane résiste aux pics d'un
 * gros produit (une simple part du total ferait baisser tous les autres ensemble).
 */
function trafficResiduals(base: SalesBase): { idx: number[]; resid: Map<string, number[]> } {
  const idx: number[] = [];
  for (let i = 0; i < WINDOW_DAYS; i++) if (base.covered[i] && base.dailyTotal[i] > 0) idx.push(i);
  const resid = new Map<string, number[]>();
  if (idx.length < MIN_CORR_DAYS) return { idx, resid };

  const ratios = new Map<string, number[]>();
  for (const [id, arr] of base.daily) {
    let sold = 0;
    let sum = 0;
    for (const i of idx) {
      sum += arr[i];
      if (arr[i] > 0) sold++;
    }
    if (sold < MIN_COMPLEMENT_DAYS || sum <= 0) continue;
    const mean = sum / idx.length;
    ratios.set(id, idx.map((i) => arr[i] / mean));
  }
  const traffic = idx.map((_, j) => median([...ratios.values()].map((r) => r[j])) || 1);
  for (const [id, r] of ratios) resid.set(id, r.map((v, j) => v / traffic[j]));
  return { idx, resid };
}

let residCache: { base: SalesBase; value: ReturnType<typeof trafficResiduals> } | null = null;

function complementsOf(base: SalesBase, summary: Summary): Complement[] {
  if (residCache?.base !== base) residCache = { base, value: trafficResiduals(base) };
  const { resid } = residCache.value;
  const target = resid.get(summary.product.id);
  if (!target) return [];

  const out: Complement[] = [];
  for (const s of base.summaries) {
    if (s.product.id === summary.product.id) continue;
    const other = resid.get(s.product.id);
    if (!other) continue;
    const r = pearson(target, other);
    if (r >= COMPLEMENT_MIN_R) out.push({ product: s.product, r, qty90: s.qty90, marginRate: s.marginRate });
  }
  return out.sort((a, b) => b.r - a.r).slice(0, 6);
}

function upcomingSeasons(
  model: DemandModel,
  seasons: DemandSeason[],
  periods: DemandSeasonPeriod[],
  productId: string,
  kindQty: Record<SellerKind, number>,
  today: string
): UpcomingSeason[] {
  const byId = new Map(seasons.map((s) => [s.id, s]));
  const limit = addDays(today, SEASON_LOOKAHEAD);
  const tot = kindQty.retail + kindQty.traiteur;
  const wR = tot > 0 ? kindQty.retail / tot : 1;
  return periods
    .filter((p) => p.end_date >= today && p.start_date <= limit && byId.has(p.season_id))
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .map((p) => {
      const s = byId.get(p.season_id)!;
      const coef =
        wR * model.productCoef(s.id, productId, "retail").value +
        (1 - wR) * model.productCoef(s.id, productId, "traiteur").value;
      return { name: s.name, start: addDays(p.start_date, -s.lead_days), end: p.end_date, coef };
    });
}

function scenariosFor(p: Product, opts: AnalysisOptions, elasticity: number): Scenario[] {
  const price = p.sale_price;
  const cost = p.purchase_price;
  const m = price - cost;
  return DISCOUNT_STEPS.map((d) => {
    const newPrice = price * (1 - d);
    const newMargin = newPrice - cost;
    const expectedUplift = Math.pow(1 - d, elasticity);
    return {
      discount: d,
      priceTTC: ttc(newPrice, p.vat_rate),
      marginRate: newPrice > 0 ? newMargin / newPrice : 0,
      breakEvenUplift: newMargin > 0 && m > 0 ? m / newMargin : Infinity,
      expectedUplift,
      profitChange: m > 0 ? (expectedUplift * newMargin) / m - 1 : 0,
      allowed: newPrice > 0 && newMargin / newPrice >= opts.marginFloor,
    };
  });
}

function planPromo(
  s: Summary,
  scenarios: Scenario[],
  seasons: UpcomingSeason[],
  weekdays: WeekdayPoint[],
  elasticity: number,
  elasticitySource: "estimated" | "assumed",
  opts: AnalysisOptions,
  today: string
): PromoPlan {
  const p = s.product;
  const maxDiscount =
    p.sale_price > 0 ? Math.max(0, 1 - p.purchase_price / (p.sale_price * (1 - opts.marginFloor))) : 0;
  const allowed = scenarios.filter((x) => x.allowed);
  const best = allowed.reduce<Scenario | null>((a, x) => (x.profitChange > (a?.profitChange ?? 0) ? x : a), null);

  // Jours faibles : les 2 jours de semaine les plus bas (parmi les jours ouvrés observés)
  const seen = weekdays.filter((w) => w.days >= 3);
  const weakDays =
    seen.length >= 4 && seen.some((w) => w.avg > 0)
      ? [...seen].sort((a, b) => a.avg - b.avg).slice(0, 2).map((w) => w.weekday)
      : [];

  const soon = seasons.filter((x) => x.start <= addDays(today, 45));
  const high = soon.find((x) => x.coef >= 1.15) ?? null;
  const low = seasons.find((x) => x.coef <= 0.85) ?? null;
  const declining = s.trend !== null && s.trend <= -0.2;
  const stale = s.quadrant === "dormant" || (s.daysSinceLastSale !== null && s.daysSinceLastSale >= 21);
  const slow = s.quadrant === "review" || s.quadrant === "potential";

  const base = { maxDiscount, elasticity, elasticitySource, scenarios, weakDays, season: null as UpcomingSeason | null };
  const smallest = allowed[0] ?? null;

  if (high && !stale) {
    return { ...base, discount: null, reason: "high_season", when: "avoid_high_season", season: high, durationDays: 0 };
  }
  if (best) {
    return {
      ...base,
      discount: best.discount,
      reason: "profitable",
      when: low ? "low_season" : declining ? "now" : "weak_days",
      season: low,
      durationDays: low ? 0 : 14,
    };
  }
  if (stale || declining || slow) {
    if (!smallest) {
      return { ...base, discount: null, reason: "no_room", when: "none", durationDays: 0 };
    }
    // Déstockage / relance : remise la plus forte autorisée jusqu'à 15 % pour un produit
    // dormant, la plus faible pour un produit simplement en baisse.
    const pick = stale ? [...allowed].filter((x) => x.discount <= 0.15).pop() ?? smallest : smallest;
    return {
      ...base,
      discount: pick.discount,
      reason: stale ? "clearance" : "revive",
      when: stale || declining ? "now" : low ? "low_season" : "weak_days",
      season: stale || declining ? null : low,
      durationDays: stale ? 7 : 14,
    };
  }
  return { ...base, discount: null, reason: "not_needed", when: "none", durationDays: 0 };
}

export function analyzeProduct(
  base: SalesBase,
  summary: Summary,
  model: DemandModel,
  seasons: DemandSeason[],
  periods: DemandSeasonPeriod[],
  opts: AnalysisOptions
): ProductAnalysis {
  const p = summary.product;
  const today = base.today;
  const kindQty = base.kindQty90.get(p.id) ?? { retail: 0, traiteur: 0 };
  const monthly = base.monthly.get(p.id) ?? base.months.map(emptyMonth);
  const weekdays = weekdayProfile(base, p.id);

  const f = model.forecast(p.id, today, addDays(today, FORECAST_DAYS - 1));
  const mT = sellerSalePrice(p, "traiteur") - p.purchase_price;
  const forecast30 = {
    qty: f.qty,
    profit: f.byKind.retail * summary.unitMargin + f.byKind.traiteur * mT,
    baselinePerDay: f.baselinePerDay,
    avgCoef: f.avgCoef,
  };

  const upcoming = upcomingSeasons(model, seasons, periods, p.id, kindQty, today);
  const complements = complementsOf(base, summary);

  const upsells = base.summaries
    .filter(
      (s) =>
        s.product.id !== p.id &&
        p.category &&
        s.product.category === p.category &&
        s.qty90 > 0 &&
        s.marginRate >= summary.marginRate + 0.05
    )
    .sort((a, b) => b.profit90 - a.profit90)
    .slice(0, 3);

  const est = estimateElasticity(base, p.id);
  const elasticity = est ?? opts.elasticity;
  const scenarios = scenariosFor(p, opts, elasticity);
  const promo = planPromo(summary, scenarios, upcoming, weekdays, elasticity, est !== null ? "estimated" : "assumed", opts, today);

  // Lot : avec le produit associé le plus lié, remise la plus forte gardant la marge plancher
  let bundle: Bundle | null = null;
  const partner = complements[0]?.product;
  if (partner && p.sale_price > 0 && partner.sale_price > 0) {
    const ht = p.sale_price + partner.sale_price;
    const cost = p.purchase_price + partner.purchase_price;
    const regularTTC = ttc(p.sale_price, p.vat_rate) + ttc(partner.sale_price, partner.vat_rate);
    for (const d of [0.1, 0.07, 0.05]) {
      const net = ht * (1 - d);
      if (net > 0 && (net - cost) / net >= opts.marginFloor) {
        bundle = { with: partner, discount: d, regularTTC, priceTTC: regularTTC * (1 - d), marginRate: (net - cost) / net };
        break;
      }
    }
  }

  // Prix : remonter au plancher, ou tester une hausse sur un produit d'appel qui se vend bien
  let priceAdvice: PriceAdvice | null = null;
  const retail30 = forecast30.qty > 0 ? f.byKind.retail : (kindQty.retail / WINDOW_DAYS) * 30;
  if (p.sale_price > 0 && summary.marginRate < opts.marginFloor) {
    const newPriceHT = p.purchase_price / (1 - opts.marginFloor);
    priceAdvice = {
      kind: "raise_to_floor",
      newPriceHT,
      pct: newPriceHT / p.sale_price - 1,
      extraProfit30: retail30 * (newPriceHT - p.sale_price),
    };
  } else if (summary.quadrant === "traffic" && (summary.trend ?? 0) >= -0.05 && summary.sellRate >= 0.5) {
    const newPriceHT = p.sale_price * 1.03;
    priceAdvice = { kind: "test_increase", newPriceHT, pct: 0.03, extraProfit30: retail30 * (newPriceHT - p.sale_price) };
  }

  const insights = buildInsights(summary, base, forecast30, upcoming, complements, upsells, kindQty, opts);

  return {
    summary,
    monthly,
    weekdays,
    kindQty,
    forecast30,
    seasons: upcoming,
    complements,
    upsells,
    bundle,
    promo,
    priceAdvice,
    insights,
  };
}

function buildInsights(
  s: Summary,
  base: SalesBase,
  forecast30: ProductAnalysis["forecast30"],
  seasons: UpcomingSeason[],
  complements: Complement[],
  upsells: Summary[],
  kindQty: Record<SellerKind, number>,
  opts: AnalysisOptions
): Insight[] {
  const out: Insight[] = [];
  const pct = (x: number) => Math.round(x * 100);

  if (s.unitMargin < 0) out.push({ tone: "bad", key: "pa_ins_negative_margin" });
  else if (s.marginRate < opts.marginFloor) out.push({ tone: "warn", key: "pa_ins_low_margin", vars: { floor: pct(opts.marginFloor) } });
  else if (s.marginRate >= base.medianMargin * 1.3 && s.marginRate > 0) out.push({ tone: "good", key: "pa_ins_high_margin" });

  if (s.traiteurMargin !== null && s.product.traiteur_price != null && s.traiteurMargin < 0)
    out.push({ tone: "bad", key: "pa_ins_traiteur_loss" });

  if (s.abc === "A") out.push({ tone: "good", key: "pa_ins_abc_a", vars: { share: pct(s.profitShare) } });
  if (s.quadrant === "star") out.push({ tone: "good", key: "pa_ins_star" });
  if (s.quadrant === "traffic") out.push({ tone: "info", key: "pa_ins_traffic" });
  if (s.quadrant === "potential") out.push({ tone: "info", key: "pa_ins_potential" });
  if (s.quadrant === "review") out.push({ tone: "warn", key: "pa_ins_review" });
  if (s.quadrant === "dormant") out.push({ tone: "bad", key: "pa_ins_dormant" });

  if (s.trend !== null) {
    if (s.trend >= 0.2) out.push({ tone: "good", key: "pa_ins_trend_up", vars: { pct: pct(s.trend) } });
    else if (s.trend <= -0.2) out.push({ tone: "warn", key: "pa_ins_trend_down", vars: { pct: pct(-s.trend) } });
  }
  if (s.daysSinceLastSale !== null && s.daysSinceLastSale >= 14 && s.quadrant !== "dormant")
    out.push({ tone: "warn", key: "pa_ins_no_recent_sale", vars: { days: s.daysSinceLastSale } });

  const lm = s.lastMonth.qty;
  const pm = s.prevMonth.qty;
  if (pm > 0 && lm > 0) {
    const ch = lm / pm - 1;
    if (Math.abs(ch) >= 0.15)
      out.push({ tone: ch > 0 ? "good" : "warn", key: ch > 0 ? "pa_ins_month_up" : "pa_ins_month_down", vars: { pct: pct(Math.abs(ch)) } });
  }

  const high = seasons.find((x) => x.coef >= 1.15);
  if (high) out.push({ tone: "info", key: "pa_ins_season_high", vars: { season: high.name, pct: pct(high.coef - 1), date: high.start } });
  const low = seasons.find((x) => x.coef <= 0.85);
  if (low) out.push({ tone: "info", key: "pa_ins_season_low", vars: { season: low.name, pct: pct(1 - low.coef), date: low.start } });

  const tot = kindQty.retail + kindQty.traiteur;
  if (tot > 0) {
    const tr = kindQty.traiteur / tot;
    if (tr >= 0.6) out.push({ tone: "info", key: "pa_ins_traiteur_driven", vars: { pct: pct(tr) } });
    else if (tr === 0 && s.product.traiteur_price != null) out.push({ tone: "info", key: "pa_ins_no_traiteur" });
  }

  if (s.sellRate > 0 && s.sellRate < 0.25 && s.quadrant !== "dormant")
    out.push({ tone: "info", key: "pa_ins_irregular", vars: { pct: pct(s.sellRate) } });

  if (complements.length) out.push({ tone: "info", key: "pa_ins_complement", vars: { name: complements[0].product.name } });
  if (upsells.length) out.push({ tone: "info", key: "pa_ins_upsell", vars: { name: upsells[0].product.name } });

  if (forecast30.qty > 0 && s.lastMonth.qty > 0) {
    const ch = forecast30.qty / s.lastMonth.qty - 1;
    if (Math.abs(ch) >= 0.15)
      out.push({ tone: ch > 0 ? "good" : "warn", key: ch > 0 ? "pa_ins_forecast_up" : "pa_ins_forecast_down", vars: { pct: pct(Math.abs(ch)) } });
  }
  return out;
}
