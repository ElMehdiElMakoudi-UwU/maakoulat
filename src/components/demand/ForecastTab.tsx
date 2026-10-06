"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { fmtDays, fmtNum, today } from "@/lib/format";
import { addDays, daysBetween } from "@/lib/supplierDues";
import { rowsToCsv, downloadFile } from "@/lib/csv";
import type { DemandModel } from "@/lib/demandForecast";
import type { DemandState } from "@/lib/demandData";
import type { SellerKind } from "@/lib/types";

export function CoefBadge({ value }: { value: number }) {
  const pct = Math.round((value - 1) * 100);
  const cls =
    Math.abs(pct) < 3 ? "bg-background text-muted" : pct > 0 ? "bg-success/15 text-success" : "bg-danger/10 text-danger";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${cls}`} dir="ltr">
      ×{value.toFixed(2)}
    </span>
  );
}

export default function ForecastTab({ state, model }: { state: DemandState; model: DemandModel }) {
  const { t, lang } = useI18n();
  const [from, setFrom] = useState(addDays(today(), 1));
  const [days, setDays] = useState("7");
  const [kind, setKind] = useState<"all" | SellerKind>("all");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [hideZero, setHideZero] = useState(true);

  const nDays = Math.max(1, Math.min(365, parseInt(days) || 1));
  const to = addDays(from, nDays - 1);
  const k = kind === "all" ? undefined : kind;

  // Saisons des 4 prochains mois
  const upcoming = useMemo(() => {
    const now = today();
    const limit = addDays(now, 120);
    const byId = new Map(state.seasons.map((s) => [s.id, s]));
    return state.periods
      .filter((p) => p.end_date >= now && p.start_date <= limit && byId.has(p.season_id))
      .sort((a, b) => a.start_date.localeCompare(b.start_date))
      .map((p) => {
        const s = byId.get(p.season_id)!;
        return {
          ...p,
          season: s,
          retail: model.globalCoef(s.id, "retail").value,
          traiteur: model.globalCoef(s.id, "traiteur").value,
        };
      });
  }, [state.periods, state.seasons, model]);

  const rows = useMemo(() => {
    const lyFrom = addDays(from, -364); // même jour de semaine, un an avant
    const lyTo = addDays(to, -364);
    const s = search.trim().toLowerCase();
    return state.products
      .filter((p) => p.active)
      .filter((p) => category === "all" || (p.category ?? "") === category)
      .filter((p) => !s || p.name.toLowerCase().includes(s) || (p.name_fr ?? "").toLowerCase().includes(s))
      .map((p) => {
        const f = model.forecast(p.id, from, to, k);
        return { p, ...f, lastYear: model.observedQty(p.id, lyFrom, lyTo, k) };
      })
      .filter((r) => !hideZero || r.qty > 0 || r.lastYear > 0)
      .sort((a, b) => b.qty - a.qty);
  }, [state.products, model, from, to, k, category, search, hideZero]);

  const categories = useMemo(() => model.categories(), [model]);

  function exportCsv() {
    const csv = rowsToCsv(
      rows.map((r) => ({
        produit: r.p.name_fr || r.p.name,
        categorie: r.p.category ?? "",
        base_jour: r.baselinePerDay.toFixed(2),
        coefficient: r.avgCoef.toFixed(2),
        prevision: Math.round(r.qty),
        detail: Math.round(r.byKind.retail),
        traiteur: Math.round(r.byKind.traiteur),
        meme_periode_n1: Math.round(r.lastYear),
      }))
    );
    downloadFile(`prevision-${from}-${to}.csv`, new Blob([csv], { type: "text/csv;charset=utf-8" }));
  }

  return (
    <div className="space-y-4">
      {!model.dataRange && (
        <p className="rounded-lg bg-primary/10 px-4 py-3 text-sm text-primary">{t("dm_no_data")}</p>
      )}

      {/* Saisons à venir */}
      <div className="card p-4">
        <h2 className="mb-2 font-semibold">{t("dm_upcoming")}</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted">{t("dm_none_upcoming")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {upcoming.map((u) => {
              const startIn = daysBetween(today(), addDays(u.start_date, -u.season.lead_days));
              return (
                <div key={u.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                  <div className="font-semibold">{u.season.name}</div>
                  <div className="text-xs text-muted" dir="ltr">
                    {u.start_date} → {u.end_date}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-muted">{startIn <= 0 ? t("dm_ongoing") : `${t("dm_starts_in")} ${fmtDays(startIn, lang)}`}</span>
                    <span className="text-muted">·</span>
                    <span>{t("dm_retail_short")}</span>
                    <CoefBadge value={u.retail} />
                    <span>{t("dm_traiteur_short")}</span>
                    <CoefBadge value={u.traiteur} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Filtres */}
      <div className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-sm">
          <span className="mb-1 block text-muted">{t("dm_from")}</span>
          <input className="input" type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">{t("dm_days")}</span>
          <input className="input" type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">&nbsp;</span>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="all">{t("dm_kind_all")}</option>
            <option value="retail">{t("dm_kind_retail")}</option>
            <option value="traiteur">{t("dm_kind_traiteur")}</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">{t("category")}</span>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">{t("all_categories")}</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">{t("search")}</span>
          <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="text-muted">
          <span dir="ltr">{from} → {to}</span>
          {model.dataRange && (
            <span>
              {" "}· {t("dm_data_range")} <span dir="ltr">{model.dataRange.from}</span> {t("dm_to")}{" "}
              <span dir="ltr">{model.dataRange.to}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-muted">
            <input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} />
            {t("dm_hide_zero")}
          </label>
          <button onClick={exportCsv} className="rounded-lg border border-border bg-surface px-3 py-1.5 font-semibold">
            {t("dm_export")}
          </button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-muted">
              <th className="px-3 py-2 text-start font-medium">{t("product")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("category")}</th>
              <th className="px-3 py-2 text-end font-medium">{t("dm_baseline")}</th>
              <th className="px-3 py-2 text-center font-medium">{t("dm_coef")}</th>
              <th className="px-3 py-2 text-end font-medium">{t("dm_forecast_qty")}</th>
              <th className="px-3 py-2 text-end font-medium">{t("dm_last_year")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.p.id}>
                <td className="px-3 py-2">
                  <div className="font-medium">{r.p.name_fr || r.p.name}</div>
                  {r.p.name_fr && <div className="text-xs text-muted">{r.p.name}</div>}
                </td>
                <td className="px-3 py-2 text-muted">{r.p.category ?? "—"}</td>
                <td className="px-3 py-2 text-end tabular-nums">{fmtNum(r.baselinePerDay, lang)}</td>
                <td className="px-3 py-2 text-center"><CoefBadge value={r.avgCoef} /></td>
                <td className="px-3 py-2 text-end text-base font-bold tabular-nums">{fmtNum(Math.round(r.qty), lang)}</td>
                <td className="px-3 py-2 text-end text-muted tabular-nums">{r.lastYear ? fmtNum(Math.round(r.lastYear), lang) : "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-muted">{t("no_data")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">{t("dm_forecast_hint")}</p>
    </div>
  );
}
