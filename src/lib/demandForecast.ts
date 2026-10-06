import type {
  DemandCoefficient,
  DemandSeason,
  DemandSeasonPeriod,
  Product,
  SeasonAutoKind,
  SellerKind,
} from "./types";

// Prévision de la demande avec coefficients saisonniers.
//
//   prévision(produit, jour) = base journalière(produit, type) × coefficient(produit, type, jour)
//
// • Données : ventes saisies dans l'app (`sales`) + historique importé (`sales_history`).
//   Les quantités saisies sur une période (ex : un mois) sont réparties uniformément
//   sur ses jours. Un jour « couvert » sans vente d'un produit compte pour 0 ;
//   un jour non couvert est ignoré (donnée manquante, pas une vente nulle).
//   Si un jour est couvert par l'app, l'historique importé de ce jour est ignoré.
// • Saison : chaque occurrence active de [début − lead_days, fin]. Si deux saisons
//   se chevauchent, la plus courte (plus spécifique) l'emporte ce jour-là.
// • Coefficient appris : pour chaque occurrence passée,
//     ventes réelles pendant la saison / ventes attendues au rythme « normal »
//   (rythme des 4 semaines hors saison avant — ou après à défaut).
//   Il est ensuite rapproché de son niveau parent selon le volume observé :
//     tous produits → catégorie → produit (peu de données ⇒ proche du parent).
// • Un coefficient saisi manuellement remplace le coefficient appris à son niveau
//   et sert de référence aux niveaux inférieurs.
// • Base journalière : moyenne des 56 derniers jours couverts, désaisonnalisés
//   (quantité du jour ÷ coefficient du jour).

export const SELLER_KINDS: SellerKind[] = ["retail", "traiteur"];

const DAY_MS = 86_400_000;
const REF_WINDOW = 28; // jours de référence « normale » autour d'une saison
const MIN_REF_DAYS = 14;
const MIN_EVENT_COVERAGE = 0.5; // part minimale de la saison couverte par des données
const MAX_LIVE_GAP = 10; // jours sans saisie au-delà desquels on considère les données manquantes
const BASELINE_DAYS = 56;
const BASELINE_LOOKBACK = 365;
const SHRINK_K = 20; // unités « attendues » pour accorder 50 % de confiance au coefficient brut
const COEF_MIN = 0.3;
const COEF_MAX = 4;

export function dayIndex(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function dateOf(idx: number): string {
  return new Date(idx * DAY_MS).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------
// Dates des saisons générables automatiquement
// ---------------------------------------------------------------------

const hijriFmt = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
  timeZone: "UTC",
  month: "numeric",
  day: "numeric",
});

function hijri(idx: number): { month: number; day: number } {
  const parts = hijriFmt.formatToParts(new Date(idx * DAY_MS));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { month: get("month"), day: get("day") };
}

/**
 * Occurrences commençant dans l'année `year` (calendrier Umm al-Qura pour le
 * Ramadan et l'Aïd ; au Maroc, l'observation lunaire peut décaler d'un jour).
 */
export function autoSeasonPeriods(kind: SeasonAutoKind, year: number): { start: string; end: string }[] {
  if (kind === "summer") return [{ start: `${year}-07-01`, end: `${year}-08-31` }];
  const first = dayIndex(`${year}-01-01`);
  const last = dayIndex(`${year}-12-31`);
  const out: { start: string; end: string }[] = [];
  let runStart: number | null = null;
  // On déborde de 40 jours pour terminer une occurrence commencée en fin d'année.
  for (let d = first - 1; d <= last + 40; d++) {
    const h = hijri(d);
    const inside = kind === "ramadan" ? h.month === 9 : h.month === 12 && h.day >= 10 && h.day <= 13;
    if (inside && runStart === null) runStart = d;
    if (!inside && runStart !== null) {
      if (runStart >= first && runStart <= last) out.push({ start: dateOf(runStart), end: dateOf(d - 1) });
      runStart = null;
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// Modèle
// ---------------------------------------------------------------------

export interface QtyRecord {
  product_id: string;
  kind: SellerKind;
  start: string; // YYYY-MM-DD
  end: string; // inclus
  quantity: number;
}

export interface DemandInputs {
  products: Product[];
  live: QtyRecord[]; // ventes de l'app (une ligne par jour)
  history: QtyRecord[]; // historique importé
  seasons: DemandSeason[];
  periods: DemandSeasonPeriod[];
  manual: DemandCoefficient[];
  today: string;
}

export type CoefSource = "manual" | "learned" | "default";

export interface ResolvedCoef {
  value: number;
  source: CoefSource;
  raw: number | null; // coefficient brut observé à ce niveau (avant rapprochement)
  evidence: number; // volume « attendu » observé pendant les saisons passées
  occurrences: number;
}

interface Stat {
  actual: number;
  expected: number;
  occurrences: number;
}

const seriesKey = (productId: string, kind: SellerKind) => `${productId}|${kind}`;
const catKey = (category: string | null, kind: SellerKind) => `${category ?? ""}|${kind}`;

function shrink(stat: Stat | undefined, prior: number): { value: number; raw: number | null; evidence: number } {
  if (!stat || stat.expected <= 0) return { value: prior, raw: null, evidence: 0 };
  const raw = stat.actual / stat.expected;
  const w = stat.expected / (stat.expected + SHRINK_K);
  const value = Math.min(COEF_MAX, Math.max(COEF_MIN, prior + (raw - prior) * w));
  return { value, raw, evidence: stat.expected };
}

function addStat(map: Map<string, Stat>, key: string, actual: number, expected: number, isNewOccurrence: boolean) {
  const s = map.get(key) ?? { actual: 0, expected: 0, occurrences: 0 };
  s.actual += actual;
  s.expected += expected;
  if (isNewOccurrence) s.occurrences++;
  map.set(key, s);
}

export class DemandModel {
  readonly products: Product[];
  readonly seasons: DemandSeason[];
  readonly todayIdx: number;
  /** Premier et dernier jour couverts par des données (null si aucune donnée) */
  readonly dataRange: { from: string; to: string } | null;

  private origin: number;
  private length: number;
  private observed: Uint8Array; // couverture globale (pour dataRange)
  private liveCovered: Uint8Array; // jours couverts par les saisies de l'app (tous produits)
  private histCovered = new Map<string, Uint8Array>(); // jours couverts par l'historique, par série
  private series = new Map<string, Float64Array>();
  private seasonDay: Int16Array; // index de saison actif par jour (−1 = aucun)
  private seasonIdx = new Map<string, number>();
  private productById = new Map<string, Product>();
  // Statistiques apprises par saison : niveau produit / catégorie / global
  private statProduct: Map<string, Stat>[] = [];
  private statCategory: Map<string, Stat>[] = [];
  private statGlobal: Map<SellerKind, Stat>[] = [];
  private manual: DemandCoefficient[];
  private coefCache = new Map<string, ResolvedCoef>();
  private baselineCache = new Map<string, number>();

  constructor(input: DemandInputs) {
    this.products = input.products;
    this.seasons = input.seasons;
    this.manual = input.manual;
    this.todayIdx = dayIndex(input.today);
    for (const p of input.products) this.productById.set(p.id, p);
    input.seasons.forEach((s, i) => this.seasonIdx.set(s.id, i));

    // ---- Étendue temporelle ----
    let min = this.todayIdx;
    let max = this.todayIdx;
    for (const r of [...input.live, ...input.history]) {
      min = Math.min(min, dayIndex(r.start));
      max = Math.max(max, dayIndex(r.end));
    }
    for (const p of input.periods) {
      min = Math.min(min, dayIndex(p.start_date) - 60);
      max = Math.max(max, dayIndex(p.end_date) + 60);
    }
    max = Math.max(max, this.todayIdx + 400); // horizon de prévision
    this.origin = min - REF_WINDOW - 1;
    this.length = max - this.origin + REF_WINDOW + 2;
    this.observed = new Uint8Array(this.length);

    // ---- Couverture & quantités ----
    // App : les jours de saisie, plus les intervalles courts entre deux saisies
    // (les ventes sont souvent saisies par lots). Un long trou = pas de données.
    const liveCovered = (this.liveCovered = new Uint8Array(this.length));
    const liveDays = Array.from(new Set(input.live.map((r) => dayIndex(r.start)))).sort((x, y) => x - y);
    liveDays.forEach((d, k) => {
      liveCovered[d - this.origin] = 1;
      const next = liveDays[k + 1];
      if (next !== undefined && next - d <= MAX_LIVE_GAP) {
        for (let i = d + 1; i < next; i++) liveCovered[i - this.origin] = 1;
      }
    });
    const add = (r: QtyRecord, skipLiveDays: boolean) => {
      const a = dayIndex(r.start) - this.origin;
      const b = dayIndex(r.end) - this.origin;
      const perDay = (Number(r.quantity) || 0) / (b - a + 1);
      const key = seriesKey(r.product_id, r.kind);
      let arr = this.series.get(key);
      if (!arr) this.series.set(key, (arr = new Float64Array(this.length)));
      // Historique : couverture propre à chaque série (cellule vide = inconnu, pas 0)
      let cov = skipLiveDays ? this.histCovered.get(key) : undefined;
      if (skipLiveDays && !cov) this.histCovered.set(key, (cov = new Uint8Array(this.length)));
      for (let i = a; i <= b; i++) {
        if (skipLiveDays && liveCovered[i]) continue;
        this.observed[i] = 1;
        if (cov) cov[i] = 1;
        arr[i] += perDay;
      }
    };
    for (const r of input.history) add(r, true);
    for (const r of input.live) add(r, false);
    for (let i = 0; i < this.length; i++) if (liveCovered[i]) this.observed[i] = 1;

    let first = -1;
    let last = -1;
    for (let i = 0; i < this.length; i++) {
      if (!this.observed[i]) continue;
      if (first < 0) first = i;
      last = i;
    }
    this.dataRange = first < 0 ? null : { from: dateOf(first + this.origin), to: dateOf(last + this.origin) };

    // ---- Jours de saison (la fenêtre la plus courte l'emporte) ----
    this.seasonDay = new Int16Array(this.length).fill(-1);
    const span = new Int32Array(this.length).fill(0x7fffffff);
    const windows = this.seasonWindows(input.periods);
    for (const w of windows) {
      const len = w.b - w.a + 1;
      for (let i = Math.max(0, w.a); i <= Math.min(this.length - 1, w.b); i++) {
        if (len < span[i]) {
          span[i] = len;
          this.seasonDay[i] = w.season;
        }
      }
    }

    this.learn(windows);
  }

  /** Le jour i est-il couvert par des données pour cette série ? */
  private obs(key: string, i: number): boolean {
    return this.liveCovered[i] === 1 || this.histCovered.get(key)?.[i] === 1;
  }

  private seasonWindows(periods: DemandSeasonPeriod[]) {
    const out: { season: number; a: number; b: number }[] = [];
    for (const p of periods) {
      const s = this.seasonIdx.get(p.season_id);
      if (s === undefined) continue;
      const lead = Number(this.seasons[s].lead_days) || 0;
      out.push({
        season: s,
        a: dayIndex(p.start_date) - lead - this.origin,
        b: dayIndex(p.end_date) - this.origin,
      });
    }
    return out;
  }

  // ---- Apprentissage des coefficients ----
  private learn(windows: { season: number; a: number; b: number }[]) {
    this.statProduct = this.seasons.map(() => new Map());
    this.statCategory = this.seasons.map(() => new Map());
    this.statGlobal = this.seasons.map(() => new Map());
    const todayI = this.todayIdx - this.origin;

    for (const w of windows) {
      const minEvent = Math.max(2, (w.b - w.a + 1) * MIN_EVENT_COVERAGE);
      // Jours candidats : passés, dans la saison (non pris par une saison plus spécifique)
      const eventCand: number[] = [];
      for (let i = Math.max(0, w.a); i <= w.b && i < todayI; i++) {
        if (this.seasonDay[i] === w.season) eventCand.push(i);
      }
      // Référence hors saison : avant, puis après à défaut
      const refBefore: number[] = [];
      for (let i = Math.max(0, w.a - REF_WINDOW); i < w.a; i++) if (this.seasonDay[i] === -1) refBefore.push(i);
      const refAfter: number[] = [];
      for (let i = w.b + 1; i <= w.b + REF_WINDOW && i < todayI; i++) if (this.seasonDay[i] === -1) refAfter.push(i);

      const touched = new Set<string>();
      for (const [key, arr] of this.series) {
        const eventDays = eventCand.filter((i) => this.obs(key, i));
        if (eventDays.length < minEvent) continue;
        let refDays = refBefore.filter((i) => this.obs(key, i));
        if (refDays.length < MIN_REF_DAYS) refDays = refDays.concat(refAfter.filter((i) => this.obs(key, i)));
        if (refDays.length < MIN_REF_DAYS) continue;

        let actual = 0;
        for (const i of eventDays) actual += arr[i];
        let ref = 0;
        for (const i of refDays) ref += arr[i];
        const expected = (ref / refDays.length) * eventDays.length;
        if (actual === 0 && expected === 0) continue;

        const [productId, kind] = key.split("|") as [string, SellerKind];
        const product = this.productById.get(productId);
        if (!product) continue;
        addStat(this.statProduct[w.season], key, actual, expected, true);
        const ck = catKey(product.category, kind);
        addStat(this.statCategory[w.season], ck, actual, expected, !touched.has(ck));
        touched.add(ck);
        const g = this.statGlobal[w.season].get(kind) ?? { actual: 0, expected: 0, occurrences: 0 };
        g.actual += actual;
        g.expected += expected;
        if (!touched.has(kind)) g.occurrences++;
        touched.add(kind);
        this.statGlobal[w.season].set(kind, g);
      }
    }
  }

  private findManual(seasonId: string, kind: SellerKind, match: (c: DemandCoefficient) => boolean): number | null {
    let any: number | null = null;
    for (const c of this.manual) {
      if (c.season_id !== seasonId || !match(c)) continue;
      if (c.seller_kind === kind) return Number(c.coefficient);
      if (c.seller_kind === null) any = Number(c.coefficient);
    }
    return any;
  }

  private resolveLevel(manual: number | null, stat: Stat | undefined, prior: number): ResolvedCoef {
    const learned = shrink(stat, prior);
    const occurrences = stat?.occurrences ?? 0;
    if (manual !== null) return { value: manual, source: "manual", raw: learned.raw, evidence: learned.evidence, occurrences };
    return {
      value: learned.value,
      source: learned.raw === null ? "default" : "learned",
      raw: learned.raw,
      evidence: learned.evidence,
      occurrences,
    };
  }

  /** Coefficient tous produits pour une saison et un type de client */
  globalCoef(seasonId: string, kind: SellerKind): ResolvedCoef {
    const ck = `g|${seasonId}|${kind}`;
    const hit = this.coefCache.get(ck);
    if (hit) return hit;
    const s = this.seasonIdx.get(seasonId)!;
    const manual = this.findManual(seasonId, kind, (c) => !c.product_id && !c.category);
    const res = this.resolveLevel(manual, this.statGlobal[s]?.get(kind), 1);
    this.coefCache.set(ck, res);
    return res;
  }

  categoryCoef(seasonId: string, category: string | null, kind: SellerKind): ResolvedCoef {
    const parent = this.globalCoef(seasonId, kind);
    if (!category) return parent;
    const ck = `c|${seasonId}|${category}|${kind}`;
    const hit = this.coefCache.get(ck);
    if (hit) return hit;
    const s = this.seasonIdx.get(seasonId)!;
    const manual = this.findManual(seasonId, kind, (c) => !c.product_id && c.category === category);
    const res = this.resolveLevel(manual, this.statCategory[s]?.get(catKey(category, kind)), parent.value);
    this.coefCache.set(ck, res);
    return res;
  }

  productCoef(seasonId: string, productId: string, kind: SellerKind): ResolvedCoef {
    const ck = `p|${seasonId}|${productId}|${kind}`;
    const hit = this.coefCache.get(ck);
    if (hit) return hit;
    const product = this.productById.get(productId);
    const parent = this.categoryCoef(seasonId, product?.category ?? null, kind);
    const s = this.seasonIdx.get(seasonId)!;
    const manual = this.findManual(seasonId, kind, (c) => c.product_id === productId);
    const res = this.resolveLevel(manual, this.statProduct[s]?.get(seriesKey(productId, kind)), parent.value);
    this.coefCache.set(ck, res);
    return res;
  }

  /** Saison active à une date (null = période normale) */
  seasonAt(date: string): DemandSeason | null {
    const i = dayIndex(date) - this.origin;
    const s = i >= 0 && i < this.length ? this.seasonDay[i] : -1;
    return s >= 0 ? this.seasons[s] : null;
  }

  private coefAtIdx(productId: string, kind: SellerKind, i: number): number {
    const s = i >= 0 && i < this.length ? this.seasonDay[i] : -1;
    return s >= 0 ? this.productCoef(this.seasons[s].id, productId, kind).value : 1;
  }

  /** Ventes journalières « normales » (hors effet saisonnier), à partir de `fromDate` (exclu) */
  baseline(productId: string, kind: SellerKind, fromDate?: string): number {
    const end = (fromDate ? dayIndex(fromDate) : this.todayIdx + 1) - this.origin;
    const ck = `${productId}|${kind}|${end}`;
    const hit = this.baselineCache.get(ck);
    if (hit !== undefined) return hit;
    const key = seriesKey(productId, kind);
    const arr = this.series.get(key);
    let sum = 0;
    let n = 0;
    for (let i = Math.min(end - 1, this.length - 1); i >= 0 && i >= end - BASELINE_LOOKBACK && n < BASELINE_DAYS; i--) {
      if (!this.obs(key, i)) continue;
      sum += (arr?.[i] ?? 0) / this.coefAtIdx(productId, kind, i);
      n++;
    }
    const v = n ? sum / n : 0;
    this.baselineCache.set(ck, v);
    return v;
  }

  /**
   * Prévision d'un produit sur [from, to] inclus (tous types de clients confondus,
   * ou un seul si `kind` est précisé). La base est calculée sur les données
   * antérieures à `from`.
   */
  forecast(productId: string, from: string, to: string, kind?: SellerKind) {
    const a = dayIndex(from) - this.origin;
    const b = dayIndex(to) - this.origin;
    const days = Math.max(0, b - a + 1);
    let qty = 0;
    let base = 0;
    const byKind: Record<SellerKind, number> = { retail: 0, traiteur: 0 };
    for (const k of kind ? [kind] : SELLER_KINDS) {
      const bl = this.baseline(productId, k, from);
      if (bl === 0) continue;
      let q = 0;
      for (let i = a; i <= b; i++) q += bl * this.coefAtIdx(productId, k, i);
      byKind[k] = q;
      qty += q;
      base += bl * days;
    }
    return {
      qty,
      baselinePerDay: days ? base / days : 0,
      avgCoef: base > 0 ? qty / base : 1,
      byKind,
    };
  }

  /** Ventes observées d'un produit sur [from, to] (pour comparaison) */
  observedQty(productId: string, from: string, to: string, kind?: SellerKind): number {
    const a = dayIndex(from) - this.origin;
    const b = dayIndex(to) - this.origin;
    let q = 0;
    for (const k of kind ? [kind] : SELLER_KINDS) {
      const arr = this.series.get(seriesKey(productId, k));
      if (!arr) continue;
      for (let i = Math.max(0, a); i <= Math.min(b, this.length - 1); i++) q += arr[i];
    }
    return q;
  }

  /** Catégories ayant des données apprises ou des produits */
  categories(): string[] {
    const set = new Set<string>();
    for (const p of this.products) if (p.category) set.add(p.category);
    return Array.from(set).sort((x, y) => x.localeCompare(y, "fr"));
  }
}
