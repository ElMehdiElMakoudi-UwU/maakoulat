"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { fmtNum } from "@/lib/format";
import { SELLER_KINDS, type DemandModel, type ResolvedCoef } from "@/lib/demandForecast";
import type { DemandState } from "@/lib/demandData";
import type { DemandCoefficient, DemandSeason, DemandSeasonPeriod, SellerKind } from "@/lib/types";
import { CoefBadge } from "./ForecastTab";

type SetState = React.Dispatch<React.SetStateAction<DemandState | null>>;
type Scope = { product_id: string | null; category: string | null };

const sameScope = (c: DemandCoefficient, seasonId: string, s: Scope, kind: SellerKind) =>
  c.season_id === seasonId && c.product_id === s.product_id && c.category === s.category && c.seller_kind === kind;

export default function SeasonsTab({ state, model, setState }: { state: DemandState; model: DemandModel; setState: SetState }) {
  const { t } = useI18n();
  const supabase = useMemo(() => createClient(), []);
  const [selected, setSelected] = useState<string | null>(state.seasons[0]?.id ?? null);
  const [newName, setNewName] = useState("");
  const [newPeriod, setNewPeriod] = useState({ start: "", end: "" });
  const [productSearch, setProductSearch] = useState("");

  const season = state.seasons.find((s) => s.id === selected) ?? null;
  const periods = state.periods
    .filter((p) => p.season_id === selected)
    .sort((a, b) => b.start_date.localeCompare(a.start_date));

  // ---- Saisons ----
  async function addSeason() {
    const name = newName.trim();
    if (!name) return;
    const sort_order = state.seasons.reduce((m, s) => Math.max(m, s.sort_order), 0) + 1;
    const { data, error } = await supabase.from("demand_seasons").insert({ name, lead_days: 0, sort_order }).select("*").single();
    if (error || !data) return alert(error?.message);
    setState((s) => s && { ...s, seasons: [...s.seasons, data as DemandSeason] });
    setSelected((data as DemandSeason).id);
    setNewName("");
  }

  async function updateSeason(patch: Partial<DemandSeason>) {
    if (!season) return;
    await supabase.from("demand_seasons").update(patch).eq("id", season.id);
    setState((s) => s && { ...s, seasons: s.seasons.map((x) => (x.id === season.id ? { ...x, ...patch } : x)) });
  }

  async function deleteSeason() {
    if (!season || !confirm(t("dm_delete_season_confirm"))) return;
    await supabase.from("demand_seasons").delete().eq("id", season.id);
    setState(
      (s) =>
        s && {
          ...s,
          seasons: s.seasons.filter((x) => x.id !== season.id),
          periods: s.periods.filter((p) => p.season_id !== season.id),
          manual: s.manual.filter((c) => c.season_id !== season.id),
        }
    );
    setSelected(state.seasons.find((x) => x.id !== season.id)?.id ?? null);
  }

  // ---- Dates ----
  async function addPeriod() {
    if (!season || !newPeriod.start) return;
    const end = newPeriod.end && newPeriod.end >= newPeriod.start ? newPeriod.end : newPeriod.start;
    const { data, error } = await supabase
      .from("demand_season_periods")
      .insert({ season_id: season.id, start_date: newPeriod.start, end_date: end })
      .select("*")
      .single();
    if (error || !data) return alert(error?.message);
    setState((s) => s && { ...s, periods: [...s.periods, data as DemandSeasonPeriod] });
    setNewPeriod({ start: "", end: "" });
  }

  async function updatePeriod(p: DemandSeasonPeriod, patch: Partial<DemandSeasonPeriod>) {
    const next = { ...p, ...patch };
    if (!next.start_date || !next.end_date || next.end_date < next.start_date) return;
    await supabase.from("demand_season_periods").update(patch).eq("id", p.id);
    setState((s) => s && { ...s, periods: s.periods.map((x) => (x.id === p.id ? next : x)) });
  }

  async function deletePeriod(p: DemandSeasonPeriod) {
    if (!confirm(t("confirm_delete"))) return;
    await supabase.from("demand_season_periods").delete().eq("id", p.id);
    setState((s) => s && { ...s, periods: s.periods.filter((x) => x.id !== p.id) });
  }

  // ---- Coefficients manuels ----
  const manualOf = (scope: Scope, kind: SellerKind) =>
    (season && state.manual.find((c) => sameScope(c, season.id, scope, kind))?.coefficient) ?? null;

  async function setManual(scope: Scope, kind: SellerKind, raw: string) {
    if (!season) return;
    const value = parseFloat(raw.replace(",", "."));
    const current = manualOf(scope, kind);
    if ((raw.trim() === "" && current === null) || (value > 0 && Number(current) === value)) return;

    let q = supabase.from("demand_coefficients").delete().eq("season_id", season.id).eq("seller_kind", kind);
    q = scope.product_id ? q.eq("product_id", scope.product_id) : q.is("product_id", null);
    q = scope.category ? q.eq("category", scope.category) : q.is("category", null);
    await q;

    let inserted: DemandCoefficient | null = null;
    if (value > 0) {
      const { data } = await supabase
        .from("demand_coefficients")
        .insert({ season_id: season.id, ...scope, seller_kind: kind, coefficient: value })
        .select("*")
        .single();
      inserted = data as DemandCoefficient | null;
    }
    setState(
      (s) =>
        s && {
          ...s,
          manual: [...s.manual.filter((c) => !sameScope(c, season.id, scope, kind)), ...(inserted ? [inserted] : [])],
        }
    );
  }

  const categories = model.categories();
  const hasEvidence =
    season && SELLER_KINDS.some((k) => model.globalCoef(season.id, k).source === "learned");

  const productRows = useMemo(() => {
    const season = state.seasons.find((s) => s.id === selected);
    if (!season) return [];
    const s = productSearch.trim().toLowerCase();
    return state.products
      .filter((p) => p.active)
      .filter((p) => !s || p.name.toLowerCase().includes(s) || (p.name_fr ?? "").toLowerCase().includes(s))
      .map((p) => ({
        p,
        coefs: Object.fromEntries(SELLER_KINDS.map((k) => [k, model.productCoef(season.id, p.id, k)])) as Record<SellerKind, ResolvedCoef>,
      }))
      .filter((r) => s || SELLER_KINDS.some((k) => r.coefs[k].evidence > 0 || r.coefs[k].source === "manual"))
      .sort(
        (a, b) =>
          Math.max(...SELLER_KINDS.map((k) => Math.abs(b.coefs[k].value - 1))) -
          Math.max(...SELLER_KINDS.map((k) => Math.abs(a.coefs[k].value - 1)))
      );
  }, [selected, state.seasons, state.products, model, productSearch]);

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      {/* Liste des saisons */}
      <div className="card h-fit p-3">
        <h2 className="mb-2 px-1 font-semibold">{t("dm_seasons")}</h2>
        <div className="flex flex-col gap-1">
          {state.seasons.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelected(s.id)}
              className={`rounded-lg px-3 py-2 text-start text-sm font-medium ${
                s.id === selected ? "bg-primary text-primary-fg" : "hover:bg-background"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
        <div className="mt-3 flex gap-1.5 border-t border-border pt-3">
          <input className="input" placeholder={t("dm_season_name")} value={newName}
            onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addSeason()} />
          <button onClick={addSeason} title={t("dm_add_season")} className="rounded-lg bg-primary px-3 text-sm font-semibold text-primary-fg">+</button>
        </div>
      </div>

      {season && (
        <div className="space-y-4">
          {/* Réglages + dates */}
          <div className="card p-4">
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="mb-1 block text-muted">{t("dm_season_name")}</span>
                <input key={season.id} className="input w-52" defaultValue={season.name}
                  onBlur={(e) => e.target.value.trim() && e.target.value !== season.name && updateSeason({ name: e.target.value.trim() })} />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-muted">{t("dm_lead_days")}</span>
                <input key={season.id} className="input w-28" type="number" min={0} max={60} defaultValue={season.lead_days}
                  onBlur={(e) => updateSeason({ lead_days: Math.max(0, parseInt(e.target.value) || 0) })} />
              </label>
              <button onClick={deleteSeason} className="ms-auto text-sm text-danger hover:underline">✕ {t("dm_delete_season")}</button>
            </div>
            <p className="mb-3 text-xs text-muted">{t("dm_lead_hint")}</p>

            <h3 className="mb-2 text-sm font-semibold">{t("dm_periods")}</h3>
            {season.auto_kind && <p className="mb-2 text-xs text-muted">{t("dm_auto_dates")}</p>}
            <div className="flex flex-wrap gap-2">
              {periods.map((p) => (
                <div key={p.id} className="flex items-center gap-1 rounded-lg border border-border px-2 py-1">
                  <input type="date" className="bg-transparent text-sm" defaultValue={p.start_date}
                    onBlur={(e) => updatePeriod(p, { start_date: e.target.value })} />
                  <span className="text-muted">→</span>
                  <input type="date" className="bg-transparent text-sm" defaultValue={p.end_date}
                    onBlur={(e) => updatePeriod(p, { end_date: e.target.value })} />
                  <button onClick={() => deletePeriod(p)} className="px-1 text-danger">✕</button>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input type="date" className="input w-auto" value={newPeriod.start}
                onChange={(e) => setNewPeriod({ ...newPeriod, start: e.target.value })} />
              <span className="text-muted">→</span>
              <input type="date" className="input w-auto" value={newPeriod.end}
                onChange={(e) => setNewPeriod({ ...newPeriod, end: e.target.value })} />
              <button onClick={addPeriod} disabled={!newPeriod.start} className="text-sm font-medium text-primary hover:underline disabled:opacity-50">
                {t("dm_add_period")}
              </button>
            </div>
          </div>

          {/* Coefficients */}
          <div className="card p-4">
            <h3 className="mb-1 font-semibold">{t("dm_coefficients")}</h3>
            <p className="mb-3 text-xs text-muted">{t("dm_coef_hint")}</p>
            {!hasEvidence && (
              <p className="mb-3 rounded-lg bg-accent/10 px-3 py-2 text-sm">{t("dm_no_evidence")}</p>
            )}

            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-muted">
                    <th className="px-2 py-2 text-start font-medium"></th>
                    <th className="px-2 py-2 text-start font-medium">{t("dm_kind_retail")}</th>
                    <th className="px-2 py-2 text-start font-medium">{t("dm_kind_traiteur")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr className="bg-background/50">
                    <td className="px-2 py-2 font-semibold">{t("dm_all_products")}</td>
                    {SELLER_KINDS.map((k) => (
                      <td key={k} className="px-2 py-2">
                        <CoefCell coef={model.globalCoef(season.id, k)} manual={manualOf({ product_id: null, category: null }, k)}
                          onSet={(v) => setManual({ product_id: null, category: null }, k, v)} />
                      </td>
                    ))}
                  </tr>
                  <tr><td colSpan={3} className="px-2 pt-3 pb-1 text-xs font-semibold uppercase text-muted">{t("dm_by_category")}</td></tr>
                  {categories.map((c) => (
                    <tr key={c}>
                      <td className="px-2 py-2">{c}</td>
                      {SELLER_KINDS.map((k) => (
                        <td key={k} className="px-2 py-2">
                          <CoefCell coef={model.categoryCoef(season.id, c, k)} manual={manualOf({ product_id: null, category: c }, k)}
                            onSet={(v) => setManual({ product_id: null, category: c }, k, v)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={3} className="px-2 pt-3 pb-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold uppercase text-muted">{t("dm_by_product")}</span>
                        <input className="input w-48" placeholder={t("search")} value={productSearch}
                          onChange={(e) => setProductSearch(e.target.value)} />
                      </div>
                    </td>
                  </tr>
                  {productRows.map(({ p, coefs }) => (
                    <tr key={p.id}>
                      <td className="px-2 py-2">
                        <div>{p.name_fr || p.name}</div>
                        <div className="text-xs text-muted">{p.category ?? ""}</div>
                      </td>
                      {SELLER_KINDS.map((k) => (
                        <td key={k} className="px-2 py-2">
                          <CoefCell coef={coefs[k]} manual={manualOf({ product_id: p.id, category: null }, k)}
                            onSet={(v) => setManual({ product_id: p.id, category: null }, k, v)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                  {productRows.length === 0 && (
                    <tr><td colSpan={3} className="p-4 text-center text-muted">{t("no_data")}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CoefCell({ coef, manual, onSet }: { coef: ResolvedCoef; manual: number | null; onSet: (v: string) => void }) {
  const { t, lang } = useI18n();
  const detail =
    coef.raw !== null
      ? `${t("dm_observed")} ×${coef.raw.toFixed(2)} · ${fmtNum(coef.occurrences, lang)} ${t("dm_occurrences")}`
      : t(coef.source === "manual" ? "dm_manual" : "dm_default");
  return (
    <div className="flex items-center gap-2">
      <CoefBadge value={coef.value} />
      <input
        key={`${manual}`}
        type="number"
        step="0.05"
        min="0.1"
        defaultValue={manual ?? ""}
        placeholder={t("dm_override")}
        onBlur={(e) => onSet(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className={`w-20 rounded border px-1.5 py-1 text-end text-xs focus:border-primary focus:outline-none ${
          manual !== null ? "border-primary bg-primary/5 font-semibold" : "border-border bg-transparent"
        }`}
      />
      <span className="hidden text-[11px] text-muted xl:inline">{detail}</span>
    </div>
  );
}
