"use client";

import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { useI18n, type Lang } from "@/lib/i18n";
import { fmtMoney, fmtNum, fmtPct, today } from "@/lib/format";
import { dayIndex } from "@/lib/demandForecast";
import { SERIES, STATUS, INK } from "@/lib/chartColors";
import {
  NO_CATEGORY,
  type CategoryAction,
  type CategoryReport,
  type CategoryRole,
  type CategorySummary,
} from "@/lib/categoryInsights";
import type { InsightTone, Quadrant } from "@/lib/productInsights";

const ROLES: CategoryRole[] = ["pillar", "rising", "at_risk", "marginal"];
const ROLE_COLOR: Record<CategoryRole, string> = {
  pillar: "bg-success/15 text-success",
  rising: "bg-primary/10 text-primary",
  at_risk: "bg-accent/15 text-accent",
  marginal: "bg-danger/10 text-danger",
};
const QUADRANTS: Quadrant[] = ["star", "traffic", "potential", "review", "dormant"];
const TONE: Record<InsightTone, { icon: string; color?: string }> = {
  good: { icon: "✅", color: STATUS.good },
  warn: { icon: "⚠️", color: STATUS.warning },
  bad: { icon: "⛔", color: STATUS.critical },
  info: { icon: "💡" },
};

function fill(s: string, vars?: Record<string, string | number>) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

function fmtDate(d: string, lang: Lang) {
  const [y, m, day] = d.split("-").map(Number);
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-MA" : "fr-FR", { day: "numeric", month: "short" }).format(
    new Date(y, m - 1, day)
  );
}

function monthShort(m: string, lang: Lang) {
  const [y, mo] = m.split("-").map(Number);
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-MA" : "fr-FR", { month: "short", year: "2-digit" }).format(
    new Date(y, mo - 1, 1)
  );
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

export function useCategoryName() {
  const { t } = useI18n();
  return (c: string) => (c === NO_CATEGORY ? t("ca_no_category") : c);
}

export default function CategoryAnalysis({
  report,
  onOpenProduct,
}: {
  report: CategoryReport;
  onOpenProduct: (id: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const cat = selected ? report.categories.find((c) => c.category === selected) : null;
  return cat ? (
    <CategoryDetail c={cat} report={report} onBack={() => setSelected(null)} onOpenProduct={onOpenProduct} />
  ) : (
    <CategoryOverview report={report} onOpen={setSelected} />
  );
}

// ---------------------------------------------------------------------
// Vue d'ensemble des catégories
// ---------------------------------------------------------------------

function CategoryOverview({ report, onOpen }: { report: CategoryReport; onOpen: (c: string) => void }) {
  const { t, lang } = useI18n();
  const name = useCategoryName();
  const [showAll, setShowAll] = useState(false);
  const roleCount = useMemo(() => {
    const r: Record<string, number> = {};
    for (const c of report.categories) r[c.role] = (r[c.role] ?? 0) + 1;
    return r;
  }, [report]);

  const chartData = report.categories
    .filter((c) => c.profit90 !== 0)
    .map((c) => ({ label: name(c.category), profit: Math.round(c.profit90) }));
  const actions = showAll ? report.actions : report.actions.slice(0, 8);

  const staleDays = report.lastDataDate ? dayIndex(today()) - dayIndex(report.lastDataDate) : null;

  return (
    <div className="space-y-4">
      {(staleDays === null || staleDays > 7) && (
        <p className="rounded-lg bg-accent/10 px-4 py-3 text-sm text-accent">
          ⚠️ {report.lastDataDate
            ? fill(t("ca_stale_data"), { date: fmtDate(report.lastDataDate, lang), days: staleDays ?? 0 })
            : t("ca_no_recent_data")}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {ROLES.map((r) => (
          <div key={r} className="card p-3">
            <div className="flex items-center justify-between">
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ROLE_COLOR[r]}`}>{t(`ca_role_${r}`)}</span>
              <span className="text-lg font-bold tabular-nums">{roleCount[r] ?? 0}</span>
            </div>
            <p className="mt-1.5 text-xs text-muted">{t(`ca_role_${r}_hint`)}</p>
          </div>
        ))}
      </div>

      {/* Plan d'action global */}
      <div className="card p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-bold">🎯 {t("ca_action_plan")}</h3>
          <span className="text-xs text-muted">{t("ca_action_plan_hint")}</span>
        </div>
        {report.actions.length === 0 ? (
          <p className="text-sm text-muted">{t("pa_no_insight")}</p>
        ) : (
          <>
            <ActionList actions={actions} showCategory onCategory={onOpen} />
            {report.actions.length > 8 && (
              <button onClick={() => setShowAll(!showAll)} className="mt-3 text-sm text-primary hover:underline">
                {showAll ? t("ca_show_less") : fill(t("ca_show_all"), { n: report.actions.length })}
              </button>
            )}
          </>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h3 className="font-bold">{t("ca_table_title")}</h3>
          <span className="text-xs text-muted">{t("ca_click_hint")}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted">
                <th className="px-4 py-2 text-start font-medium">{t("ca_category")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("ca_ca_90")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("ca_profit_90")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("ca_profit_share")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("margin")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("pa_trend_30")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("ca_products")}</th>
                <th className="px-4 py-2 text-center font-medium">{t("ca_role")}</th>
                <th className="px-4 py-2 text-center font-medium">{t("ca_actions_col")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.categories.map((c) => {
                const urgent = c.actions.filter((a) => a.priority === 1).length;
                return (
                  <tr key={c.category} onClick={() => onOpen(c.category)} className="cursor-pointer hover:bg-background">
                    <td className="px-4 py-2.5 font-medium">{name(c.category)}</td>
                    <td className="px-4 py-2.5 text-end tabular-nums">{fmtMoney(c.ca90, lang)}</td>
                    <td className="px-4 py-2.5 text-end font-semibold tabular-nums"
                      style={{ color: c.profit90 < 0 ? STATUS.critical : undefined }}>
                      {fmtMoney(c.profit90, lang)}
                    </td>
                    <td className="px-4 py-2.5 text-end tabular-nums">
                      <ShareBar value={c.profitShare} lang={lang} />
                    </td>
                    <td className="px-4 py-2.5 text-end tabular-nums"
                      style={{ color: c.marginRate < report.avgMargin - 0.05 ? STATUS.critical : undefined }}>
                      {fmtPct(c.marginRate, lang)}
                    </td>
                    <td className="px-4 py-2.5 text-end"><Trend value={c.trend} lang={lang} /></td>
                    <td className="px-4 py-2.5 text-end tabular-nums text-muted">
                      {c.soldCount}/{c.activeCount}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${ROLE_COLOR[c.role]}`}>
                        {t(`ca_role_${c.role}`)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center text-xs">
                      {urgent > 0 ? (
                        <span className="font-semibold" style={{ color: STATUS.critical }}>⚠ {urgent}</span>
                      ) : (
                        <span className="text-muted">{c.actions.length}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {report.categories.length === 0 && (
                <tr><td colSpan={9} className="p-6 text-center text-muted">{t("no_data")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="border-t border-border px-4 py-2 text-xs text-muted">
          {fill(t("ca_table_footnote"), { margin: fmtPct(report.avgMargin, lang) })}
        </p>
      </div>

      {chartData.length > 1 && (
        <div className="card p-4">
          <h3 className="font-bold">{t("ca_chart_profit")}</h3>
          <p className="mb-2 text-xs text-muted">{t("ca_chart_profit_hint")}</p>
          <div dir="ltr">
            <ResponsiveContainer width="100%" height={Math.max(160, chartData.length * 34)}>
              <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid stroke={INK.grid} horizontal={false} />
                <XAxis type="number" tick={{ fill: INK.secondary, fontSize: 11 }} tickLine={false} axisLine={false}
                  tickFormatter={(v) => new Intl.NumberFormat("fr").format(v as number)} />
                <YAxis type="category" dataKey="label" width={130} tick={{ fill: INK.secondary, fontSize: 12 }}
                  tickLine={false} axisLine={{ stroke: INK.grid }} />
                <Tooltip cursor={{ fill: INK.grid, opacity: 0.4 }} formatter={(v) => [fmtMoney(Number(v), lang), t("ca_profit_90")]} />
                <Bar isAnimationActive={false} dataKey="profit" fill={SERIES.profit} radius={[0, 4, 4, 0]} barSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

function ShareBar({ value, lang }: { value: number; lang: Lang }) {
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="hidden h-1.5 w-16 overflow-hidden rounded-full sm:inline-block" style={{ background: INK.grid }} dir="ltr">
        <span className="block h-full rounded-full" style={{ width: `${Math.min(100, value * 100)}%`, background: SERIES.profit }} />
      </span>
      {fmtPct(value, lang)}
    </span>
  );
}

function ActionList({
  actions,
  showCategory,
  onCategory,
  onProduct,
  productNames,
}: {
  actions: CategoryAction[];
  showCategory?: boolean;
  onCategory?: (c: string) => void;
  onProduct?: (id: string) => void;
  productNames?: Map<string, string>;
}) {
  const { t, lang } = useI18n();
  const name = useCategoryName();
  return (
    <ul className="divide-y divide-border text-sm">
      {actions.map((a, i) => (
        <li key={i} className="flex gap-3 py-2.5">
          <span className="shrink-0">{TONE[a.tone].icon}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                a.priority === 1 ? "bg-danger/10 text-danger" : a.priority === 2 ? "bg-accent/15 text-accent" : "bg-background text-muted"
              }`}>
                {t(`ca_prio_${a.priority}`)}
              </span>
              {showCategory && (
                <button onClick={() => onCategory?.(a.category)} className="text-xs font-semibold text-primary hover:underline">
                  {name(a.category)}
                </button>
              )}
            </div>
            <p className="mt-1" style={{ color: a.tone === "info" ? undefined : TONE[a.tone].color }}>
              {fill(t(a.key), { ...a.vars, ...(a.vars?.date ? { date: fmtDate(String(a.vars.date), lang) } : {}) })}
            </p>
            {onProduct && productNames && a.products.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {a.products.slice(0, 8).map((id) => (
                  <button key={id} onClick={() => onProduct(id)}
                    className="rounded-full border border-border px-2 py-0.5 text-xs hover:border-primary hover:text-primary">
                    {productNames.get(id)}
                  </button>
                ))}
                {a.products.length > 8 && <span className="text-xs text-muted">+{a.products.length - 8}</span>}
              </div>
            )}
          </div>
          {a.impact30 !== null && a.impact30 > 0 && (
            <div className="shrink-0 text-end">
              <div className="font-semibold tabular-nums" style={{ color: STATUS.good }}>+{fmtMoney(a.impact30, lang)}</div>
              <div className="text-[10px] text-muted">{t("ca_impact_30")}</div>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------
// Fiche catégorie
// ---------------------------------------------------------------------

function CategoryDetail({
  c,
  report,
  onBack,
  onOpenProduct,
}: {
  c: CategorySummary;
  report: CategoryReport;
  onBack: () => void;
  onOpenProduct: (id: string) => void;
}) {
  const { t, lang } = useI18n();
  const name = useCategoryName();
  const lmChange = c.prevMonth.profit > 0 ? c.lastMonth.profit / c.prevMonth.profit - 1 : null;
  const monthlyData = c.monthly.map((m) => ({ label: monthShort(m.month, lang), profit: Math.round(m.profit), qty: m.qty }));
  const productNames = useMemo(() => new Map(c.products.map((s) => [s.product.id, s.product.name])), [c]);
  const kindTot = c.kindQty.retail + c.kindQty.traiteur;

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [c.category]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button onClick={onBack} className="mb-2 text-sm text-primary hover:underline">← {t("ca_back")}</button>
          <h2 className="text-xl font-bold">{name(c.category)}</h2>
          <p className="text-sm text-muted">
            {fill(t("ca_detail_sub"), { rank: c.rank, total: report.categories.length, n: c.activeCount, sold: c.soldCount })}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${ROLE_COLOR[c.role]}`}>{t(`ca_role_${c.role}`)}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("ca_profit_90")} value={fmtMoney(c.profit90, lang)}
          sub={`${fmtPct(c.profitShare, lang)} ${t("ca_of_total_profit")}`} />
        <Kpi label={t("ca_ca_90")} value={fmtMoney(c.ca90, lang)}
          sub={`${fmtPct(c.caShare, lang)} ${t("ca_of_total_ca")}`} />
        <Kpi label={t("margin")} value={fmtPct(c.marginRate, lang)}
          color={c.marginRate < report.avgMargin - 0.05 ? STATUS.critical : undefined}
          sub={`${t("ca_catalog_avg")} ${fmtPct(report.avgMargin, lang)}`} />
        <Kpi label={t("pa_trend_30")} value={<Trend value={c.trend} lang={lang} />}
          sub={lmChange !== null ? <>{t("ca_profit_last_month")} <Trend value={lmChange} lang={lang} /></> : undefined} />
      </div>

      <div className="card p-4">
        <h3 className="mb-1 font-bold">🎯 {t("ca_recommended")}</h3>
        {c.actions.length === 0 ? (
          <p className="text-sm text-muted">{t("pa_no_insight")}</p>
        ) : (
          <ActionList actions={c.actions} onProduct={onOpenProduct} productNames={productNames} />
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card p-4">
          <h3 className="font-bold">{t("ca_monthly_profit")}</h3>
          <p className="mb-2 text-xs text-muted">{t("ca_monthly_profit_hint")}</p>
          <div dir="ltr">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={monthlyData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid stroke={INK.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: INK.secondary, fontSize: 11 }} tickLine={false} axisLine={{ stroke: INK.grid }} />
                <YAxis tick={{ fill: INK.secondary, fontSize: 11 }} tickLine={false} axisLine={false} width={56}
                  tickFormatter={(v) => new Intl.NumberFormat("fr").format(v as number)} />
                <Tooltip cursor={{ fill: INK.grid, opacity: 0.4 }}
                  formatter={(v, _n, item) => [
                    `${fmtMoney(Number(v), lang)} · ${fmtNum((item?.payload as { qty: number })?.qty ?? 0, lang)} ${t("units")}`,
                    t("profit"),
                  ]} />
                <Bar isAnimationActive={false} dataKey="profit" fill={SERIES.profit} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-4">
          <h3 className="font-bold">🔮 {t("pa_potential")}</h3>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-background p-3">
              <div className="text-xs text-muted">{t("pa_profit_30")}</div>
              <div className="text-lg font-bold tabular-nums">{fmtMoney(c.forecast30.profit, lang)}</div>
              <div className="text-xs text-muted">{t("pa_vs_last_month")} {fmtMoney(c.lastMonth.profit, lang)}</div>
            </div>
            <div className="rounded-lg bg-background p-3">
              <div className="text-xs text-muted">{t("pa_split")}</div>
              <div className="text-lg font-bold tabular-nums">
                {kindTot > 0 ? `${fmtPct(c.kindQty.retail / kindTot, lang)} / ${fmtPct(c.kindQty.traiteur / kindTot, lang)}` : "—"}
              </div>
              <div className="text-xs text-muted">{t("ca_split_hint")}</div>
            </div>
          </div>
          <h4 className="mt-4 text-sm font-semibold">{t("ca_upcoming_seasons")}</h4>
          {c.seasons.length === 0 ? (
            <p className="mt-1 text-sm text-muted">{t("pa_no_season")}</p>
          ) : (
            <ul className="mt-1 divide-y divide-border text-sm">
              {c.seasons.map((x, i) => {
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
          <div className="mt-4 flex flex-wrap gap-1.5 text-xs">
            {QUADRANTS.filter((q) => c.quadrants[q] > 0).map((q) => (
              <span key={q} className="rounded-full bg-background px-2 py-0.5">
                {t(`pa_q_${q}`)} <b className="tabular-nums">{c.quadrants[q]}</b>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="font-bold">{t("ca_products_in")}</h3>
          <span className="text-xs text-muted">{t("pa_click_hint")}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted">
                <th className="px-4 py-2 text-start font-medium">{t("product")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("ca_profit_90")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("ca_share_in_cat")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("margin")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("pa_trend_30")}</th>
                <th className="px-4 py-2 text-center font-medium">{t("pa_profile")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {c.products.map((s) => (
                <tr key={s.product.id} onClick={() => onOpenProduct(s.product.id)} className="cursor-pointer hover:bg-background">
                  <td className="px-4 py-2.5 font-medium">{s.product.name}</td>
                  <td className="px-4 py-2.5 text-end font-semibold tabular-nums">{fmtMoney(s.profit90, lang)}</td>
                  <td className="px-4 py-2.5 text-end tabular-nums text-muted">
                    {c.profit90 > 0 ? fmtPct(Math.max(0, s.profit90) / c.profit90, lang) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-end tabular-nums" style={{ color: s.marginRate < 0 ? STATUS.critical : undefined }}>
                    {fmtPct(s.marginRate, lang)}
                  </td>
                  <td className="px-4 py-2.5 text-end"><Trend value={s.trend} lang={lang} /></td>
                  <td className="px-4 py-2.5 text-center text-xs">{t(`pa_q_${s.quadrant}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, color }: { label: string; value: React.ReactNode; sub?: React.ReactNode; color?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums" style={{ color }}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}
