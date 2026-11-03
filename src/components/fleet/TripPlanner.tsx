"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { fmtMoney, fmtNum } from "@/lib/format";
import {
  breakEven, DEFAULT_FUEL_PRICE, DEPOT, fetchRoute, fuelLiters, PLACES, searchPlace,
  vehicleMonthlyFixed, type RouteResult, type VehicleStats,
} from "@/lib/fleet";
import type { Vehicle } from "@/lib/types";
import type { MapPoint } from "./FleetMap";

const FleetMap = dynamic(() => import("./FleetMap"), { ssr: false });

type Stop = { name: string; lat: number; lng: number };

// Hypothèses du plan, conservées dans le navigateur (préférence de l'utilisateur)
const STORE_KEY = "fleet_plan_v1";
const DEFAULT_PLAN = {
  dieselPrice: String(DEFAULT_FUEL_PRICE.diesel),
  essencePrice: String(DEFAULT_FUEL_PRICE.essence),
  tolls: "0",
  otherPerTrip: "0",
  tripsPerMonth: "8",
  maintenancePerKm: "",
  dedicated: true,
  staffMonthly: "0",
  otherFixedMonthly: "0",
  marginRate: "",
  targetProfit: "0",
};

export default function TripPlanner({
  vehicles,
  stats,
  salesMarginRate,
}: {
  vehicles: Vehicle[];
  stats: Map<string, VehicleStats>;
  salesMarginRate: number | null;
}) {
  const { t, lang } = useI18n();
  const active = vehicles.filter((v) => v.status === "active");

  const [stops, setStops] = useState<Stop[]>([PLACES[0]]);
  const [roundTrip, setRoundTrip] = useState(true);
  const [vehicleId, setVehicleId] = useState(active[0]?.id ?? "");
  const [l100, setL100] = useState(active[0] ? String(active[0].consumption_l100) : "10");
  // Dernier itinéraire reçu, rattaché à la liste d'arrêts qui l'a demandé
  const [fetched, setFetched] = useState<{ key: string; route: RouteResult | null; error: boolean } | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Stop[]>([]);
  const [searching, setSearching] = useState(false);
  // Rendu uniquement côté client (onglet ouvert après chargement) : lecture directe du stockage
  const [plan, setPlan] = useState(() => {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (saved) return { ...DEFAULT_PLAN, ...JSON.parse(saved) } as typeof DEFAULT_PLAN;
    } catch {}
    return DEFAULT_PLAN;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(plan));
    } catch {}
  }, [plan]);

  const vehicle = active.find((v) => v.id === vehicleId) ?? null;
  const vStats = vehicle ? stats.get(vehicle.id) : undefined;

  function pickVehicle(id: string) {
    setVehicleId(id);
    const v = active.find((x) => x.id === id);
    if (v) setL100(String(v.consumption_l100));
  }

  // Recalcule l'itinéraire à chaque changement d'arrêts
  const routeKey = JSON.stringify([stops, roundTrip]);
  useEffect(() => {
    if (stops.length === 0) return;
    const pts = [DEPOT, ...stops, ...(roundTrip ? [DEPOT] : [])];
    let cancelled = false;
    fetchRoute(pts)
      .then((r) => !cancelled && setFetched({ key: routeKey, route: r, error: false }))
      .catch(() => !cancelled && setFetched({ key: routeKey, route: null, error: true }));
    return () => {
      cancelled = true;
    };
  }, [stops, roundTrip, routeKey]);
  const current = stops.length > 0 && fetched?.key === routeKey ? fetched : null;
  const route = current?.route ?? null;
  const routing = stops.length > 0 && !current;
  const routeError = current?.error ?? false;

  async function runSearch() {
    if (!query.trim()) return;
    setSearching(true);
    setResults(await searchPlace(query.trim()));
    setSearching(false);
  }

  const addStop = (s: Stop) => setStops((prev) => [...prev, s]);
  const moveStop = (i: number, d: -1 | 1) =>
    setStops((prev) => {
      const j = i + d;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const points: MapPoint[] = useMemo(
    () => [{ ...DEPOT, label: DEPOT.name, kind: "depot" as const }, ...stops.map((s) => ({ ...s, label: s.name, kind: "stop" as const }))],
    [stops]
  );

  // ---- Coût de la tournée ----
  const fuelPrice = parseFloat(vehicle?.fuel_type === "essence" ? plan.essencePrice : plan.dieselPrice) || 0;
  const consumption = parseFloat(l100) || 0;
  const distance = route?.distanceKm ?? 0;
  const liters = fuelLiters(distance, consumption);
  const fuelCost = liters * fuelPrice;
  const tolls = parseFloat(plan.tolls) || 0;
  const otherPerTrip = parseFloat(plan.otherPerTrip) || 0;
  const tripCost = fuelCost + tolls + otherPerTrip;

  // ---- Seuil de rentabilité ----
  const marginRate = plan.marginRate !== "" ? parseFloat(plan.marginRate) || 0 : salesMarginRate ?? 0;
  const maintenancePerKm =
    plan.maintenancePerKm !== "" ? parseFloat(plan.maintenancePerKm) || 0 : vStats?.maintenancePerKm ?? 0.5;
  const be = breakEven({
    tripsPerMonth: parseInt(plan.tripsPerMonth) || 0,
    distancePerTrip: distance,
    fuelCostPerTrip: fuelCost,
    tollsPerTrip: tolls,
    otherPerTrip,
    maintenancePerKm,
    vehicleFixedMonthly: plan.dedicated && vehicle ? vehicleMonthlyFixed(vehicle) : 0,
    staffMonthly: parseFloat(plan.staffMonthly) || 0,
    otherFixedMonthly: parseFloat(plan.otherFixedMonthly) || 0,
    marginRate,
    targetProfit: parseFloat(plan.targetProfit) || 0,
  });
  const finite = Number.isFinite(be.breakEvenSales);
  const set = (k: keyof typeof DEFAULT_PLAN) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setPlan({ ...plan, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 lg:grid-cols-5">
        {/* Carte */}
        <div className="lg:col-span-3">
          <FleetMap
            points={points}
            route={route?.coords ?? null}
            onMapClick={(lat, lng) => addStop({ name: `${t("fl_point")} ${lat.toFixed(3)}, ${lng.toFixed(3)}`, lat, lng })}
            className="h-[420px] w-full"
          />
          <p className="mt-1 text-xs text-muted">{t("fl_map_hint")}</p>
        </div>

        {/* Arrêts */}
        <div className="card p-4 lg:col-span-2">
          <h2 className="mb-2 font-bold">{t("fl_route")}</h2>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {PLACES.map((p) => (
              <button key={p.name} onClick={() => addStop(p)}
                className="rounded-full border border-border px-2.5 py-0.5 text-xs hover:border-primary hover:text-primary">
                + {p.name}
              </button>
            ))}
          </div>
          <div className="mb-2 flex gap-2">
            <input className="input" placeholder={t("fl_search_place")} value={query}
              onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runSearch()} />
            <button onClick={runSearch} disabled={searching}
              className="rounded-lg border border-border px-3 text-sm disabled:opacity-50">🔍</button>
          </div>
          {results.length > 0 && (
            <div className="mb-2 flex flex-col rounded-lg border border-border text-sm">
              {results.map((r, i) => (
                <button key={i} onClick={() => { addStop(r); setResults([]); setQuery(""); }}
                  className="truncate px-3 py-1.5 text-start hover:bg-background">+ {r.name}</button>
              ))}
            </div>
          )}

          <ol className="mb-2 flex flex-col gap-1 text-sm">
            <li className="flex items-center gap-2 text-muted">🏠 {DEPOT.name}</li>
            {stops.map((s, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-black">{i + 1}</span>
                <span className="flex-1 truncate">{s.name}</span>
                <button onClick={() => moveStop(i, -1)} className="text-xs text-muted">▲</button>
                <button onClick={() => moveStop(i, 1)} className="text-xs text-muted">▼</button>
                <button onClick={() => setStops(stops.filter((_, j) => j !== i))} className="text-xs text-danger">✕</button>
              </li>
            ))}
            {roundTrip && <li className="flex items-center gap-2 text-muted">🏠 {t("fl_return_depot")}</li>}
          </ol>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={roundTrip} onChange={(e) => setRoundTrip(e.target.checked)} />
              {t("fl_round_trip")}
            </label>
            {stops.length > 0 && (
              <button onClick={() => setStops([])} className="text-xs text-danger hover:underline">{t("fl_clear_stops")}</button>
            )}
          </div>
        </div>
      </div>

      {/* Simulation carburant */}
      <div className="card p-4">
        <h2 className="mb-3 font-bold">⛽ {t("fl_fuel_sim")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label={t("fl_vehicle")}>
            <select className="input" value={vehicleId} onChange={(e) => pickVehicle(e.target.value)}>
              {active.length === 0 && <option value="">—</option>}
              {active.map((v) => <option key={v.id} value={v.id}>{v.name} {v.plate && `(${v.plate})`}</option>)}
            </select>
          </Field>
          <Field label={t("fl_consumption")}>
            <input type="number" min={0} step={0.1} className="input" value={l100} onChange={(e) => setL100(e.target.value)} />
            {vStats?.realConsumption != null && (
              <button onClick={() => setL100(vStats.realConsumption!.toFixed(1))} className="mt-1 text-xs text-primary hover:underline">
                {t("fl_use_real")} {fmtNum(vStats.realConsumption, lang)} L
              </button>
            )}
          </Field>
          <Field label={`${t("fl_price_per_l")} (${vehicle?.fuel_type === "essence" ? t("fl_essence") : t("fl_diesel")})`}>
            {vehicle?.fuel_type === "essence"
              ? <input type="number" min={0} step={0.01} className="input" value={plan.essencePrice} onChange={set("essencePrice")} />
              : <input type="number" min={0} step={0.01} className="input" value={plan.dieselPrice} onChange={set("dieselPrice")} />}
          </Field>
          <Field label={t("fl_tolls")}>
            <input type="number" min={0} className="input" value={plan.tolls} onChange={set("tolls")} />
          </Field>
          <Field label={t("fl_other_per_trip")}>
            <input type="number" min={0} className="input" value={plan.otherPerTrip} onChange={set("otherPerTrip")} />
          </Field>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label={t("fl_distance")} value={routing ? "…" : `${fmtNum(Math.round(distance), lang)} km`}
            sub={route ? `≈ ${Math.floor(route.durationMin / 60)} h ${String(Math.round(route.durationMin % 60)).padStart(2, "0")}` : ""} />
          <Stat label={t("fl_liters")} value={`${fmtNum(Math.round(liters * 10) / 10, lang)} L`} />
          <Stat label={t("fl_fuel_cost")} value={fmtMoney(Math.round(fuelCost), lang)} />
          <Stat label={t("fl_trip_cost")} value={fmtMoney(Math.round(tripCost), lang)} strong />
          <Stat label={t("fl_cost_per_km")} value={distance > 0 ? fmtMoney(tripCost / distance, lang) : "—"} />
        </div>
        {routeError && <p className="mt-2 text-sm text-danger">{t("fl_route_error")}</p>}
      </div>

      {/* Plan de rentabilité */}
      <div className="card p-4">
        <h2 className="font-bold">📈 {t("fl_plan_title")}</h2>
        <p className="mb-3 text-xs text-muted">{t("fl_plan_hint")}</p>
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("fl_trips_per_month")}>
              <input type="number" min={0} className="input" value={plan.tripsPerMonth} onChange={set("tripsPerMonth")} />
            </Field>
            <Field label={t("fl_maintenance_per_km")}>
              <input type="number" min={0} step={0.01} className="input" value={plan.maintenancePerKm} onChange={set("maintenancePerKm")}
                placeholder={vStats?.maintenancePerKm != null ? vStats.maintenancePerKm.toFixed(2) : "0.50"} />
            </Field>
            <Field label={t("fl_staff_monthly")}>
              <input type="number" min={0} className="input" value={plan.staffMonthly} onChange={set("staffMonthly")} />
            </Field>
            <Field label={t("fl_other_fixed")}>
              <input type="number" min={0} className="input" value={plan.otherFixedMonthly} onChange={set("otherFixedMonthly")} />
            </Field>
            <Field label={t("fl_margin_rate")}>
              <input type="number" min={0} max={100} step={0.1} className="input" value={plan.marginRate} onChange={set("marginRate")}
                placeholder={salesMarginRate != null ? salesMarginRate.toFixed(1) : ""} />
              {salesMarginRate != null && (
                <div className="mt-1 text-xs text-muted">{t("fl_margin_from_sales")} {fmtNum(Math.round(salesMarginRate * 10) / 10, lang)} %</div>
              )}
            </Field>
            <Field label={t("fl_target_profit")}>
              <input type="number" min={0} className="input" value={plan.targetProfit} onChange={set("targetProfit")} />
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={plan.dedicated} onChange={set("dedicated")} />
              {t("fl_dedicated_vehicle")}
              {vehicle && <span className="text-muted">({fmtMoney(Math.round(vehicleMonthlyFixed(vehicle)), lang)} / {t("fl_month")})</span>}
            </label>
          </div>

          <div>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                <Row label={`${t("fl_variable_costs")} (${fmtNum(Math.round(be.kmPerMonth), lang)} km)`} value={fmtMoney(Math.round(be.variableMonthly), lang)} />
                <Row label={t("fl_fixed_costs")} value={fmtMoney(Math.round(be.fixedMonthly), lang)} />
                <Row label={t("fl_total_costs")} value={fmtMoney(Math.round(be.totalMonthly), lang)} strong />
                <Row label={t("fl_full_trip_cost")} value={fmtMoney(Math.round(be.costPerTrip), lang)} />
              </tbody>
            </table>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-danger/40 bg-danger/5 p-3">
                <div className="text-xs font-medium text-muted">{t("fl_break_even")}</div>
                <div className="text-xl font-bold text-danger">{finite ? fmtMoney(Math.round(be.breakEvenSales), lang) : "—"}</div>
                <div className="text-xs text-muted">{t("fl_sales_ht_month")}</div>
              </div>
              <div className="rounded-xl border border-success/40 bg-success/5 p-3">
                <div className="text-xs font-medium text-muted">{t("fl_target_sales")}</div>
                <div className="text-xl font-bold text-success">{finite ? fmtMoney(Math.round(be.targetSales), lang) : "—"}</div>
                <div className="text-xs text-muted">{finite ? `${fmtMoney(Math.round(be.salesPerTrip), lang)} ${t("fl_per_trip")}` : t("fl_need_margin")}</div>
              </div>
            </div>

            {finite && be.breakEvenSales > 0 && (
              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted">
                    <th className="py-1.5 text-start font-medium">{t("fl_scenario_sales")}</th>
                    <th className="py-1.5 text-end font-medium">{t("fl_gross_margin")}</th>
                    <th className="py-1.5 text-end font-medium">{t("fl_result")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {[0.5, 1, 1.5, 2, 3].map((k) => {
                    const sales = be.breakEvenSales * k;
                    const margin = (sales * marginRate) / 100;
                    const res = margin - be.totalMonthly;
                    return (
                      <tr key={k}>
                        <td className="py-1.5">{fmtMoney(Math.round(sales), lang)}</td>
                        <td className="py-1.5 text-end">{fmtMoney(Math.round(margin), lang)}</td>
                        <td className={`py-1.5 text-end font-semibold ${res >= 0 ? "text-success" : "text-danger"}`}>
                          {res >= 0 ? "+" : ""}{fmtMoney(Math.round(res), lang)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

function Stat({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className="rounded-xl bg-background p-3">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={`mt-0.5 text-lg font-bold ${strong ? "text-primary" : ""}`}>{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <tr className={strong ? "font-bold" : ""}>
      <td className="py-1.5">{label}</td>
      <td className="py-1.5 text-end">{value}</td>
    </tr>
  );
}
