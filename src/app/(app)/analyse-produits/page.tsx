"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { createClient } from "@/lib/supabase/client";
import { useI18n, type Lang } from "@/lib/i18n";
import { fmtMoney, fmtNum, fmtPct, today, ttc } from "@/lib/format";
import { SERIES, STATUS, INK } from "@/lib/chartColors";
import { DemandModel } from "@/lib/demandForecast";
import { fetchAll, loadDemandState, toInputs, type DemandState } from "@/lib/demandData";
import {
  analyzeProduct,
  buildSalesBase,
  salesFetchStart,
  type Insight,
  type PricedSale,
  type ProductAnalysis,
  type Quadrant,
  type SalesBase,
  type Summary,
} from "@/lib/productInsights";
import type { Seller, Supplier } from "@/lib/types";

type SortKey = "profit90" | "lastMonth" | "margin" | "trend" | "name";

const QUADRANTS: Quadrant[] = ["star", "traffic", "potential", "review", "dormant"];
const QUADRANT_COLOR: Record<Quadrant, string> = {
  star: "bg-success/15 text-success",
  traffic: "bg-primary/10 text-primary",
  potential: "bg-accent/15 text-accent",
  review: "bg-background text-muted",
  dormant: "bg-danger/10 text-danger",
};
const TONE: Record<Insight["tone"], { icon: string; color: string }> = {
  good: { icon: "✅", color: STATUS.good },
  warn: { icon: "⚠️", color: STATUS.warning },
  bad: { icon: "⛔", color: STATUS.critical },
  info: { icon: "💡", color: INK.secondary },
};

function fmtDate(d: string, lang: Lang) {
  const [y, m, day] = d.split("-").map(Number);
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-MA" : "fr-FR", { day: "numeric", month: "short" }).format(
    new Date(y, m - 1, day)
  );
}

function weekdayName(w: number, lang: Lang, style: "short" | "long" = "short") {
  // 7 janvier 2024 = dimanche
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-MA" : "fr-FR", { weekday: style }).format(new Date(2024, 0, 7 + w));
}

function monthShort(m: string, lang: Lang) {
  const [y, mo] = m.split("-").map(Number);
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-MA" : "fr-FR", { month: "short", year: "2-digit" }).format(
    new Date(y, mo - 1, 1)
  );
}

function fill(s: string, vars?: Record<string, string | number>) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

function Trend({ value, lang }: { value: number | null; lang: Lang }) {
  if (value === null) return <span className="text-muted">—</span>;
  const color = Math.abs(value) < 0.05 ? INK.secondary : value > 0 ? STATUS.good : STATUS.critical;
  return (
    <span className="font-semibold tabular-nums" style={{ color }} dir="ltr">
      {value > 0 ? "▲" : value < 0 ? "▼" : ""} {fmtPct(Math.abs(value), lang)}
    </span>
  );
}

export default function ProductAnalysisPage() {
  const { t } = useI18n();
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<DemandState | null>(null);
  const [base, setBase] = useState<SalesBase | null>(null);
  const [suppliers, setSuppliers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const [marginFloor, setMarginFloor] = useState(0.1);
  const [elasticity, setElasticity] = useState(-2);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const now = today();
    (async () => {
      try {
        const [demand, sellers, sales, sup] = await Promise.all([
          loadDemandState(supabase),
          fetchAll<Seller>((a, b) => supabase.from("sellers").select("*").range(a, b)),
          fetchAll<PricedSale>((a, b) =>
            supabase
              .from("sales")
              .select("product_id,seller_id,sale_date,quantity,purchase_price,sale_price")
              .gte("sale_date", salesFetchStart(now))
              .order("id")
              .range(a, b)
          ),
          fetchAll<Supplier>((a, b) => supabase.from("suppliers").select("id,name").range(a, b)),
        ]);
        const kindOf = new Map(sellers.map((s) => [s.id, s.kind]));
        setState(demand);
        setBase(buildSalesBase(demand.products, sales, kindOf, now));
        setSuppliers(Object.fromEntries(sup.map((s) => [s.id, s.name])));
      } catch (e) {
        setError((e as { message?: string })?.message ?? String(e));
      }
    })();
  }, [supabase]);

  const model = useMemo(() => (state ? new DemandModel(toInputs(state)) : null), [state]);

  const analysis = useMemo(() => {
    if (!base || !model || !state || !selected) return null;
    const s = base.summaries.find((x) => x.product.id === selected);
    if (!s) return null;
    return analyzeProduct(base, s, model, state.seasons, state.periods, { marginFloor, elasticity });
  }, [base, model, state, selected, marginFloor, elasticity]);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("pa_title")}</h1>
          <p className="text-sm text-muted">{t("pa_subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            {t("pa_margin_floor")}
            <select
              value={marginFloor}
              onChange={(e) => setMarginFloor(Number(e.target.value))}
              className="rounded-lg border border-border bg-surface px-2 py-1.5"
            >
              {[0.05, 0.1, 0.15, 0.2, 0.25].map((v) => (
                <option key={v} value={v}>{Math.round(v * 100)}%</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2" title={t("pa_sensitivity_hint")}>
            {t("pa_sensitivity")}
            <select
              value={elasticity}
              onChange={(e) => setElasticity(Number(e.target.value))}
              className="rounded-lg border border-border bg-surface px-2 py-1.5"
            >
              <option value={-1.2}>{t("pa_sens_low")}</option>
              <option value={-2}>{t("pa_sens_mid")}</option>
              <option value={-3}>{t("pa_sens_high")}</option>
            </select>
          </label>
        </div>
      </div>

      {error ? (
        <p className="rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>
      ) : !base || !model ? (
        <p className="p-8 text-center text-muted">{t("loading")}</p>
      ) : analysis ? (
        <ProductDetail a={analysis} supplier={suppliers[analysis.summary.product.supplier_id ?? ""]} floor={marginFloor}
          onBack={() => setSelected(null)} onOpen={setSelected} />
      ) : (
        <ProductList base={base} onOpen={setSelected} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Vue d'ensemble
// ---------------------------------------------------------------------

function ProductList({ base, onOpen }: { base: SalesBase; onOpen: (id: string) => void }) {
  const { t, lang } = useI18n();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [quadrant, setQuadrant] = useState<"all" | Quadrant>("all");
  const [sort, setSort] = useState<SortKey>("profit90");

  const categories = useMemo(
    () => [...new Set(base.summaries.map((s) => s.product.category).filter(Boolean) as string[])].sort(),
    [base]
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of base.summaries) c[s.quadrant] = (c[s.quadrant] ?? 0) + 1;
    return c;
  }, [base]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = base.summaries.filter(
      (s) =>
        (category === "all" || (s.product.category ?? "") === category) &&
        (quadrant === "all" || s.quadrant === quadrant) &&
        (!q || s.product.name.toLowerCase().includes(q) || (s.product.name_fr ?? "").toLowerCase().includes(q))
    );
    const by: Record<SortKey, (a: Summary, b: Summary) => number> = {
      profit90: (a, b) => b.profit90 - a.profit90,
      lastMonth: (a, b) => b.lastMonth.profit - a.lastMonth.profit,
      margin: (a, b) => b.marginRate - a.marginRate,
      trend: (a, b) => (a.trend ?? Infinity) - (b.trend ?? Infinity),
      name: (a, b) => a.product.name.localeCompare(b.product.name),
    };
    return list.sort(by[sort]);
  }, [base, search, category, quadrant, sort]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {QUADRANTS.map((q) => (
          <button
            key={q}
            onClick={() => setQuadrant(quadrant === q ? "all" : q)}
            className={`card p-3 text-start transition ${quadrant === q ? "ring-2 ring-primary" : "hover:border-primary"}`}
          >
            <div className="flex items-center justify-between">
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${QUADRANT_COLOR[q]}`}>{t(`pa_q_${q}`)}</span>
              <span className="text-lg font-bold tabular-nums">{counts[q] ?? 0}</span>
            </div>
            <p className="mt-1.5 text-xs text-muted">{t(`pa_q_${q}_hint`)}</p>
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("pa_search")}
            className="input max-w-xs"
          />
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-border bg-surface px-2 py-2 text-sm">
            <option value="all">{t("pa_all_categories")}</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="rounded-lg border border-border bg-surface px-2 py-2 text-sm">
            <option value="profit90">{t("pa_sort_profit90")}</option>
            <option value="lastMonth">{t("pa_sort_last_month")}</option>
            <option value="margin">{t("pa_sort_margin")}</option>
            <option value="trend">{t("pa_sort_trend")}</option>
            <option value="name">{t("pa_sort_name")}</option>
          </select>
          <span className="ms-auto text-xs text-muted">{t("pa_click_hint")}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted">
                <th className="px-4 py-2 text-start font-medium">{t("product")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("margin")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("pa_qty_last_month")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("pa_profit_last_month")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("pa_trend_30")}</th>
                <th className="px-4 py-2 text-center font-medium">{t("pa_profile")}</th>
                <th className="px-4 py-2 text-center font-medium">ABC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((s) => (
                <tr key={s.product.id} onClick={() => onOpen(s.product.id)} className="cursor-pointer hover:bg-background">
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{s.product.name}</div>
                    {(s.product.name_fr || s.product.category) && (
                      <div className="text-xs text-muted">{[s.product.name_fr, s.product.category].filter(Boolean).join(" · ")}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-end tabular-nums"
                    style={{ color: s.marginRate < 0 ? STATUS.critical : undefined }}>
                    {fmtPct(s.marginRate, lang)}
                  </td>
                  <td className="px-4 py-2.5 text-end tabular-nums">{fmtNum(s.lastMonth.qty, lang)}</td>
                  <td className="px-4 py-2.5 text-end font-semibold tabular-nums">{fmtMoney(s.lastMonth.profit, lang)}</td>
                  <td className="px-4 py-2.5 text-end"><Trend value={s.trend} lang={lang} /></td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${QUADRANT_COLOR[s.quadrant]}`}>
                      {t(`pa_q_${s.quadrant}`)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-center font-semibold">{s.abc ?? "—"}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="p-6 text-center text-muted">{t("no_data")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Fiche produit
// ---------------------------------------------------------------------

function ProductDetail({
  a,
  supplier,
  floor,
  onBack,
  onOpen,
}: {
  a: ProductAnalysis;
  supplier?: string;
  floor: number;
  onBack: () => void;
  onOpen: (id: string) => void;
}) {
  const { t, lang } = useI18n();
  const s = a.summary;
  const p = s.product;
  const lmChange = s.prevMonth.qty > 0 ? s.lastMonth.qty / s.prevMonth.qty - 1 : null;

  const monthlyData = a.monthly.map((m) => ({ ...m, label: monthShort(m.month, lang) }));
  const weekdayData = [1, 2, 3, 4, 5, 6, 0].map((w) => ({
    label: weekdayName(w, lang),
    avg: Math.round(a.weekdays[w].avg * 100) / 100,
    weak: a.promo.weakDays.includes(w),
  }));

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [p.id]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button onClick={onBack} className="mb-2 text-sm text-primary hover:underline">← {t("pa_back")}</button>
          <h2 className="text-xl font-bold">{p.name}</h2>
          <p className="text-sm text-muted">
            {[p.name_fr, p.category, p.unit, supplier].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex gap-2">
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${QUADRANT_COLOR[s.quadrant]}`}>{t(`pa_q_${s.quadrant}`)}</span>
          {s.abc && <span className="rounded-full bg-background px-3 py-1 text-sm font-semibold">{t("pa_class")} {s.abc}</span>}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("pa_unit_margin")} value={fmtMoney(s.unitMargin, lang)}
          sub={`${fmtPct(s.marginRate, lang)} · ${t("pa_markup")} ${p.purchase_price > 0 ? fmtPct(s.unitMargin / p.purchase_price, lang) : "—"}`}
          color={s.marginRate < floor ? STATUS.critical : undefined} />
        <Kpi label={t("pa_last_month")} value={`${fmtNum(s.lastMonth.qty, lang)} ${t("units")}`}
          sub={<>{fmtMoney(s.lastMonth.ca, lang)} · {t("profit")} {fmtMoney(s.lastMonth.profit, lang)}</>}
          extra={lmChange !== null ? <><span className="text-muted">{t("pa_vs_prev_month")} </span><Trend value={lmChange} lang={lang} /></> : null} />
        <Kpi label={t("pa_trend_30")} value={<Trend value={s.trend} lang={lang} />}
          sub={s.daysSinceLastSale !== null ? fill(t("pa_last_sale_days"), { days: s.daysSinceLastSale }) : t("pa_never_sold")} />
        <Kpi label={t("pa_profit_share")} value={fmtPct(s.profitShare, lang)}
          sub={`${t("pa_sell_rate")} ${fmtPct(s.sellRate, lang)}`} />
      </div>

      {/* Prix */}
      <div className="card grid gap-3 p-4 text-sm sm:grid-cols-4">
        <PriceCell label={t("purchase_price")} value={fmtMoney(p.purchase_price, lang)} />
        <PriceCell label={t("pa_retail_price_ttc")} value={fmtMoney(ttc(p.sale_price, p.vat_rate), lang)}
          sub={`${t("pa_ht")} ${fmtMoney(p.sale_price, lang)} · TVA ${fmtNum(p.vat_rate, lang)}%`} />
        <PriceCell label={t("traiteur_price")} value={p.traiteur_price != null ? fmtMoney(p.traiteur_price, lang) : "—"}
          sub={s.traiteurMargin !== null ? `${t("margin")} ${fmtMoney(s.traiteurMargin, lang)}` : undefined} />
        <PriceCell label={t("pa_split")}
          value={`${fmtNum(a.kindQty.retail, lang)} / ${fmtNum(a.kindQty.traiteur, lang)}`}
          sub={t("pa_split_hint")} />
      </div>

      {/* Suggestions */}
      <div className="card p-4">
        <h3 className="mb-3 font-bold">🧠 {t("pa_insights")}</h3>
        {a.insights.length === 0 ? (
          <p className="text-sm text-muted">{t("pa_no_insight")}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {a.insights.map((ins, i) => (
              <li key={i} className="flex gap-2">
                <span>{TONE[ins.tone].icon}</span>
                <span style={{ color: ins.tone === "info" ? undefined : TONE[ins.tone].color }}>
                  {fill(t(ins.key), {
                    ...ins.vars,
                    ...(ins.vars?.date ? { date: fmtDate(String(ins.vars.date), lang) } : {}),
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <PromoCard a={a} floor={floor} />
        <PotentialCard a={a} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card p-4">
          <h3 className="font-bold">{t("pa_monthly")}</h3>
          <p className="mb-2 text-xs text-muted">{t("pa_monthly_hint")}</p>
          <div dir="ltr">
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={monthlyData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid stroke={INK.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: INK.secondary, fontSize: 11 }} tickLine={false} axisLine={{ stroke: INK.grid }} />
                <YAxis yAxisId="q" tick={{ fill: INK.secondary, fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
                <YAxis yAxisId="m" orientation="right" tick={{ fill: INK.secondary, fontSize: 11 }} tickLine={false} axisLine={false} width={56}
                  tickFormatter={(v) => new Intl.NumberFormat("fr").format(v as number)} />
                <Tooltip formatter={(v, name) => [fmtNum(Number(v), lang), name]} />
                <Legend />
                <Bar yAxisId="q" isAnimationActive={false} dataKey="qty" name={t("quantity")} fill={SERIES.ca} radius={[4, 4, 0, 0]} />
                <Line yAxisId="m" isAnimationActive={false} type="monotone" dataKey="profit" name={t("profit")} stroke={SERIES.profit} strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-4">
          <h3 className="font-bold">{t("pa_weekdays")}</h3>
          <p className="mb-2 text-xs text-muted">{t("pa_weekdays_hint")}</p>
          <div dir="ltr">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={weekdayData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid stroke={INK.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: INK.secondary, fontSize: 11 }} tickLine={false} axisLine={{ stroke: INK.grid }} />
                <YAxis tick={{ fill: INK.secondary, fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
                <Tooltip formatter={(v) => [fmtNum(Number(v), lang), t("pa_avg_per_day")]} />
                <Bar isAnimationActive={false} dataKey="avg" name={t("pa_avg_per_day")} radius={[4, 4, 0, 0]}
                  shape={(props: unknown) => {
                    const { x, y, width, height, payload } = props as { x: number; y: number; width: number; height: number; payload: { weak: boolean } };
                    return <rect x={x} y={y} width={width} height={Math.max(0, height)} rx={4} fill={payload.weak ? SERIES.third : SERIES.ca} />;
                  }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <AssociationsCard a={a} onOpen={onOpen} />
    </div>
  );
}

function Kpi({ label, value, sub, extra, color }: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  extra?: React.ReactNode;
  color?: string;
}) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums" style={{ color }}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
      {extra && <div className="mt-1 text-xs">{extra}</div>}
    </div>
  );
}

function PriceCell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

function PromoCard({ a, floor }: { a: ProductAnalysis; floor: number }) {
  const { t, lang } = useI18n();
  const promo = a.promo;
  const p = a.summary.product;
  const days = promo.weakDays.map((w) => weekdayName(w, lang, "long")).join(" & ");

  let when = "";
  if (promo.when === "avoid_high_season" && promo.season)
    when = fill(t("pa_when_avoid"), { season: promo.season.name, date: fmtDate(promo.season.start, lang) });
  else if (promo.when === "low_season" && promo.season)
    when = fill(t("pa_when_low_season"), {
      season: promo.season.name,
      from: fmtDate(promo.season.start, lang),
      to: fmtDate(promo.season.end, lang),
    });
  else if (promo.when === "now") when = fill(t("pa_when_now"), { days: promo.durationDays });
  else if (promo.when === "weak_days")
    when = days ? fill(t("pa_when_weak_days"), { days, n: promo.durationDays }) : fill(t("pa_when_now"), { days: promo.durationDays });

  const rec = promo.discount !== null ? a.promo.scenarios.find((x) => x.discount === promo.discount) : null;

  return (
    <div className="card p-4">
      <h3 className="font-bold">🏷️ {t("pa_promo")}</h3>
      <div className="mt-3 rounded-lg bg-background p-3">
        {rec ? (
          <>
            <div className="text-lg font-bold">
              {fill(t("pa_promo_rec"), { pct: Math.round(rec.discount * 100) })}{" "}
              <span className="text-sm font-normal text-muted">
                ({fmtMoney(ttc(p.sale_price, p.vat_rate), lang)} → <b>{fmtMoney(rec.priceTTC, lang)}</b> TTC)
              </span>
            </div>
            <p className="mt-1 text-sm">{t(`pa_reason_${promo.reason}`)}</p>
            {when && <p className="mt-1 text-sm">📅 {when}</p>}
            <p className="mt-1 text-xs text-muted">
              {fill(t("pa_promo_need"), {
                pct: Number.isFinite(rec.breakEvenUplift) ? Math.round((rec.breakEvenUplift - 1) * 100) : "∞",
              })}
            </p>
          </>
        ) : (
          <>
            <div className="text-lg font-bold">{t("pa_promo_none")}</div>
            <p className="mt-1 text-sm">{t(`pa_reason_${promo.reason}`)}</p>
            {when && <p className="mt-1 text-sm">📅 {when}</p>}
          </>
        )}
        {a.bundle && (
          <p className="mt-2 border-t border-border pt-2 text-sm">
            🎁 {fill(t("pa_bundle"), {
              name: a.bundle.with.name,
              pct: Math.round(a.bundle.discount * 100),
              price: fmtMoney(a.bundle.priceTTC, lang),
              regular: fmtMoney(a.bundle.regularTTC, lang),
            })}
          </p>
        )}
        {a.priceAdvice && (
          <p className="mt-2 border-t border-border pt-2 text-sm">
            💰 {fill(t(`pa_price_${a.priceAdvice.kind}`), {
              price: fmtMoney(ttc(a.priceAdvice.newPriceHT, p.vat_rate), lang),
              pct: Math.round(a.priceAdvice.pct * 100),
              gain: fmtMoney(a.priceAdvice.extraProfit30, lang),
            })}
          </p>
        )}
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted">
              <th className="px-2 py-1.5 text-start font-medium">{t("pa_discount")}</th>
              <th className="px-2 py-1.5 text-end font-medium">{t("pa_price_ttc")}</th>
              <th className="px-2 py-1.5 text-end font-medium">{t("margin")}</th>
              <th className="px-2 py-1.5 text-end font-medium">{t("pa_breakeven")}</th>
              <th className="px-2 py-1.5 text-end font-medium">{t("pa_expected")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {promo.scenarios.map((x) => (
              <tr key={x.discount} className={!x.allowed ? "opacity-40" : x.discount === promo.discount ? "bg-primary/5 font-semibold" : ""}>
                <td className="px-2 py-1.5">−{Math.round(x.discount * 100)}%</td>
                <td className="px-2 py-1.5 text-end tabular-nums">{fmtMoney(x.priceTTC, lang)}</td>
                <td className="px-2 py-1.5 text-end tabular-nums" style={{ color: x.marginRate < floor ? STATUS.critical : undefined }}>
                  {fmtPct(x.marginRate, lang)}
                </td>
                <td className="px-2 py-1.5 text-end tabular-nums" dir="ltr">
                  {Number.isFinite(x.breakEvenUplift) ? `+${Math.round((x.breakEvenUplift - 1) * 100)}%` : "∞"}
                </td>
                <td className="px-2 py-1.5 text-end tabular-nums" dir="ltr"
                  style={{ color: x.profitChange >= 0 ? STATUS.good : STATUS.critical }}>
                  {x.profitChange >= 0 ? "+" : ""}{Math.round(x.profitChange * 100)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">
        {fill(t("pa_promo_footnote"), {
          max: Math.round(promo.maxDiscount * 100),
          floor: Math.round(floor * 100),
          e: promo.elasticity.toFixed(1),
          src: t(promo.elasticitySource === "estimated" ? "pa_elasticity_estimated" : "pa_elasticity_assumed"),
        })}
      </p>
    </div>
  );
}

function PotentialCard({ a }: { a: ProductAnalysis }) {
  const { t, lang } = useI18n();
  const f = a.forecast30;
  return (
    <div className="card p-4">
      <h3 className="font-bold">🔮 {t("pa_potential")}</h3>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-background p-3">
          <div className="text-xs text-muted">{t("pa_forecast_30")}</div>
          <div className="text-lg font-bold tabular-nums">{fmtNum(Math.round(f.qty), lang)} {t("units")}</div>
          <div className="text-xs text-muted">{fmtNum(Math.round(f.baselinePerDay * 10) / 10, lang)} / {t("pa_day")} · ×{f.avgCoef.toFixed(2)}</div>
        </div>
        <div className="rounded-lg bg-background p-3">
          <div className="text-xs text-muted">{t("pa_profit_30")}</div>
          <div className="text-lg font-bold tabular-nums">{fmtMoney(f.profit, lang)}</div>
          <div className="text-xs text-muted">{t("pa_vs_last_month")} {fmtMoney(a.summary.lastMonth.profit, lang)}</div>
        </div>
      </div>
      <h4 className="mt-4 text-sm font-semibold">{t("pa_upcoming_seasons")}</h4>
      {a.seasons.length === 0 ? (
        <p className="mt-1 text-sm text-muted">{t("pa_no_season")}</p>
      ) : (
        <ul className="mt-1 divide-y divide-border text-sm">
          {a.seasons.map((x, i) => {
            const pct = Math.round((x.coef - 1) * 100);
            return (
              <li key={i} className="flex items-center justify-between py-1.5">
                <span>
                  {x.name} <span className="text-xs text-muted">{fmtDate(x.start, lang)} → {fmtDate(x.end, lang)}</span>
                </span>
                <span className="font-semibold tabular-nums" dir="ltr"
                  style={{ color: Math.abs(pct) < 5 ? INK.secondary : pct > 0 ? STATUS.good : STATUS.critical }}>
                  {pct > 0 ? "+" : ""}{pct}%
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted">{t("pa_potential_hint")}</p>
    </div>
  );
}

function AssociationsCard({ a, onOpen }: { a: ProductAnalysis; onOpen: (id: string) => void }) {
  const { t, lang } = useI18n();
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="card overflow-hidden">
        <div className="border-b border-border px-4 py-3">
          <h3 className="font-bold">🤝 {t("pa_complements")}</h3>
          <p className="text-xs text-muted">{t("pa_complements_hint")}</p>
        </div>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-border">
            {a.complements.map((c) => (
              <tr key={c.product.id} onClick={() => onOpen(c.product.id)} className="cursor-pointer hover:bg-background">
                <td className="px-4 py-2.5">
                  <div>{c.product.name}</div>
                  <div className="text-xs text-muted">{c.product.category}</div>
                </td>
                <td className="px-4 py-2.5 text-end text-xs text-muted">{t("margin")} {fmtPct(c.marginRate, lang)}</td>
                <td className="px-4 py-2.5 text-end">
                  <LinkStrength r={c.r} />
                </td>
              </tr>
            ))}
            {a.complements.length === 0 && (
              <tr><td className="p-6 text-center text-sm text-muted">{t("pa_no_complement")}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-border px-4 py-3">
          <h3 className="font-bold">⬆️ {t("pa_upsells")}</h3>
          <p className="text-xs text-muted">{t("pa_upsells_hint")}</p>
        </div>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-border">
            {a.upsells.map((u) => (
              <tr key={u.product.id} onClick={() => onOpen(u.product.id)} className="cursor-pointer hover:bg-background">
                <td className="px-4 py-2.5">{u.product.name}</td>
                <td className="px-4 py-2.5 text-end font-semibold" style={{ color: STATUS.good }}>{fmtPct(u.marginRate, lang)}</td>
                <td className="px-4 py-2.5 text-end text-xs text-muted">{fmtNum(u.qty90, lang)} {t("units")} / 90 {t("pa_days")}</td>
              </tr>
            ))}
            {a.upsells.length === 0 && (
              <tr><td className="p-6 text-center text-sm text-muted">{t("pa_no_upsell")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LinkStrength({ r }: { r: number }) {
  const { t } = useI18n();
  const level = r >= 0.6 ? "strong" : r >= 0.4 ? "medium" : "weak";
  const bars = level === "strong" ? 3 : level === "medium" ? 2 : 1;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span className="inline-flex gap-0.5" dir="ltr">
        {[1, 2, 3].map((i) => (
          <span key={i} className="inline-block h-3 w-1.5 rounded-sm" style={{ background: i <= bars ? SERIES.profit : INK.grid }} />
        ))}
      </span>
      {t(`pa_link_${level}`)}
    </span>
  );
}
