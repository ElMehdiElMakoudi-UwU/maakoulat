import type { SupabaseClient } from "@supabase/supabase-js";
import { autoSeasonPeriods, dayIndex, type DemandInputs, type QtyRecord } from "./demandForecast";
import { today } from "./format";
import type {
  DemandCoefficient,
  DemandSeason,
  DemandSeasonPeriod,
  Product,
  SalesHistory,
  Seller,
} from "./types";

const PAGE = 1000;

/** Lit toutes les lignes d'une requête (Supabase limite chaque réponse à 1000 lignes). */
export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data as T[]) ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export interface DemandState {
  products: Product[];
  live: QtyRecord[];
  history: SalesHistory[];
  seasons: DemandSeason[];
  periods: DemandSeasonPeriod[];
  manual: DemandCoefficient[];
}

/** Charge tout ce qu'il faut pour construire le modèle de prévision. */
export async function loadDemandState(supabase: SupabaseClient): Promise<DemandState> {
  const [products, sellers, sales, history, seasons, periods, manual] = await Promise.all([
    fetchAll<Product>((a, b) => supabase.from("products").select("*").order("sort_order").range(a, b)),
    fetchAll<Seller>((a, b) => supabase.from("sellers").select("*").range(a, b)),
    fetchAll<{ product_id: string; seller_id: string; sale_date: string; quantity: number }>((a, b) =>
      supabase.from("sales").select("product_id,seller_id,sale_date,quantity").order("id").range(a, b)
    ),
    fetchAll<SalesHistory>((a, b) => supabase.from("sales_history").select("*").order("id").range(a, b)),
    fetchAll<DemandSeason>((a, b) => supabase.from("demand_seasons").select("*").order("sort_order").range(a, b)),
    fetchAll<DemandSeasonPeriod>((a, b) => supabase.from("demand_season_periods").select("*").order("start_date").range(a, b)),
    fetchAll<DemandCoefficient>((a, b) => supabase.from("demand_coefficients").select("*").range(a, b)),
  ]);

  const kindOf = new Map(sellers.map((s) => [s.id, s.kind]));
  const live: QtyRecord[] = sales.map((s) => ({
    product_id: s.product_id,
    kind: kindOf.get(s.seller_id) ?? "retail",
    start: s.sale_date,
    end: s.sale_date,
    quantity: Number(s.quantity),
  }));

  const state = { products, live, history, seasons, periods, manual };
  state.periods = await ensureAutoPeriods(supabase, state);
  return state;
}

export function toInputs(s: DemandState): DemandInputs {
  return {
    products: s.products,
    live: s.live,
    history: s.history.map((h) => ({
      product_id: h.product_id,
      kind: h.seller_kind,
      start: h.period_start,
      end: h.period_end,
      quantity: Number(h.quantity),
    })),
    seasons: s.seasons,
    periods: s.periods,
    manual: s.manual,
    today: today(),
  };
}

/**
 * Renvoie toutes les dates de saison, après avoir créé les dates manquantes des saisons automatiques (Ramadan, Aïd, Été)
 * depuis la première année de données jusqu'à l'an prochain. Une occurrence
 * déjà saisie à ±20 jours près (ex : corrigée d'un jour) n'est pas recréée.
 * Deux chargements simultanés (ex : double rendu en dev) ne créent pas de doublon :
 * les conflits sont ignorés puis la liste est relue.
 */
async function ensureAutoPeriods(
  supabase: SupabaseClient,
  s: Pick<DemandState, "live" | "history" | "seasons" | "periods">
): Promise<DemandSeasonPeriod[]> {
  const thisYear = Number(today().slice(0, 4));
  let firstYear = thisYear - 1;
  for (const r of s.live) firstYear = Math.min(firstYear, Number(r.start.slice(0, 4)));
  for (const h of s.history) firstYear = Math.min(firstYear, Number(h.period_start.slice(0, 4)));

  const missing: Omit<DemandSeasonPeriod, "id">[] = [];
  for (const season of s.seasons) {
    if (!season.auto_kind) continue;
    const existing = s.periods.filter((p) => p.season_id === season.id).map((p) => dayIndex(p.start_date));
    for (let y = firstYear; y <= thisYear + 1; y++) {
      for (const occ of autoSeasonPeriods(season.auto_kind, y)) {
        const d = dayIndex(occ.start);
        if (existing.some((e) => Math.abs(e - d) <= 20)) continue;
        missing.push({ season_id: season.id, start_date: occ.start, end_date: occ.end });
      }
    }
  }
  if (!missing.length) return s.periods;
  await supabase
    .from("demand_season_periods")
    .upsert(missing, { onConflict: "season_id,start_date", ignoreDuplicates: true });
  const { data } = await supabase.from("demand_season_periods").select("*").order("start_date");
  return (data as DemandSeasonPeriod[]) ?? s.periods;
}
