"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { currentMonth, fmtMoney, monthRange, today, ttc } from "@/lib/format";
import { SERIES, INK, STATUS } from "@/lib/chartColors";
import { addDays, allocateInvoices } from "@/lib/supplierDues";
import {
  buildForecast, forecastLows, groupByWeek, weekdayAverages, type ForecastOutflow,
} from "@/lib/treasuryForecast";
import type { BankStatement, Supplier, SupplierInvoice, SupplierPayment } from "@/lib/types";

const HISTORY_DAYS = 56; // 8 semaines d'historique pour la moyenne des ventes
const HORIZONS = [30, 60, 90] as const;

type ChargeRow = { amount: number; month: string | null; active: boolean };
type SaleRow = {
  sale_date: string;
  quantity: number;
  sale_price: number;
  products: { vat_rate: number } | { vat_rate: number }[] | null;
};

const shortDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export default function TreasuryForecast() {
  const { t, lang } = useI18n();
  const supabase = useMemo(() => createClient(), []);
  const todayStr = today();

  const [loading, setLoading] = useState(true);
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]>(30);
  const [salesPct, setSalesPct] = useState("100");
  const [balanceOverride, setBalanceOverride] = useState<string | null>(null);

  const [computedBalance, setComputedBalance] = useState(0);
  const [openingSet, setOpeningSet] = useState(true);
  const [weekdayAvg, setWeekdayAvg] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);
  const [supplierOutflows, setSupplierOutflows] = useState<ForecastOutflow[]>([]);
  const [charges, setCharges] = useState<ChargeRow[]>([]);
  const [lastStatement, setLastStatement] = useState<BankStatement | null>(null);

  useEffect(() => {
    const month = currentMonth();
    const { start } = monthRange(month);
    const histFrom = addDays(todayStr, -HISTORY_DAYS);
    const salesFrom = histFrom < start ? histFrom : start;
    (async () => {
      const [salesRes, supRes, invRes, payRes, chargeRes, setRes, bankRes] = await Promise.all([
        supabase.from("sales").select("sale_date,quantity,sale_price,products(vat_rate)")
          .gte("sale_date", salesFrom).lte("sale_date", todayStr),
        supabase.from("suppliers").select("*"),
        supabase.from("supplier_invoices").select("*"),
        supabase.from("supplier_payments").select("*"),
        supabase.from("charges").select("amount,month,active"),
        supabase.from("monthly_settings").select("opening_balance").eq("month", month).maybeSingle(),
        supabase.from("bank_statements").select("*").order("period_end", { ascending: false, nullsFirst: false }).limit(1),
      ]);

      // Ventes TTC par date
      const salesByDate: Record<string, number> = {};
      for (const s of (salesRes.data as SaleRow[]) ?? []) {
        const vat = (Array.isArray(s.products) ? s.products[0] : s.products)?.vat_rate ?? 0;
        salesByDate[s.sale_date] = (salesByDate[s.sale_date] ?? 0) + s.quantity * ttc(s.sale_price, vat);
      }
      // Moyenne sur les 8 dernières semaines complètes (aujourd'hui exclu : journée en cours)
      setWeekdayAvg(weekdayAverages(salesByDate, histFrom, addDays(todayStr, -1)));

      // Solde actuel = ouverture du mois + ventes du mois − paiements fournisseurs du mois − charges du mois
      const suppliers = (supRes.data as Supplier[]) ?? [];
      const payments = (payRes.data as SupplierPayment[]) ?? [];
      const chargeRows = (chargeRes.data as ChargeRow[]) ?? [];
      const salesMtd = Object.entries(salesByDate)
        .filter(([d]) => d >= start && d <= todayStr)
        .reduce((s, [, v]) => s + v, 0);
      const payMtd = payments
        .filter((p) => p.pay_date >= start && p.pay_date <= todayStr)
        .reduce((s, p) => s + Number(p.amount), 0);
      const chargesMonth = chargeRows
        .filter((c) => c.active && (c.month === month || c.month === null))
        .reduce((s, c) => s + Number(c.amount), 0);
      const settings = setRes.data as { opening_balance: number } | null;
      setOpeningSet(!!settings && Number(settings.opening_balance) !== 0);
      setComputedBalance((settings ? Number(settings.opening_balance) : 0) + salesMtd - payMtd - chargesMonth);

      // Échéances fournisseurs : reste à payer de chaque facture non soldée
      const names = new Map(suppliers.map((s) => [s.id, s.name]));
      setSupplierOutflows(
        allocateInvoices(suppliers, (invRes.data as SupplierInvoice[]) ?? [], payments, todayStr)
          .filter((r) => r.status !== "paid")
          .map((r) => ({
            date: r.due_date,
            amount: r.remaining,
            kind: "supplier" as const,
            label: names.get(r.supplier_id) ?? "—",
          }))
      );
      setCharges(chargeRows);
      setLastStatement(((bankRes.data as BankStatement[]) ?? [])[0] ?? null);
      setLoading(false);
    })();
  }, [supabase, todayStr]);

  // Charges des mois à venir, imputées le 1er de chaque mois de l'horizon
  const outflows = useMemo<ForecastOutflow[]>(() => {
    const end = addDays(todayStr, horizon);
    const rows: ForecastOutflow[] = [...supplierOutflows];
    let [y, m] = todayStr.split("-").map(Number);
    for (;;) {
      m++;
      if (m > 12) { m = 1; y++; }
      const month = `${y}-${String(m).padStart(2, "0")}`;
      const date = `${month}-01`;
      if (date > end) break;
      const amount = charges
        .filter((c) => c.active && (c.month === month || c.month === null))
        .reduce((s, c) => s + Number(c.amount), 0);
      if (amount > 0) rows.push({ date, amount, kind: "charges", label: t("total_charges") });
    }
    return rows;
  }, [supplierOutflows, charges, horizon, todayStr, t]);

  const startBalance =
    balanceOverride !== null && balanceOverride.trim() !== ""
      ? parseFloat(balanceOverride) || 0
      : computedBalance;
  const salesFactor = Math.max(0, parseFloat(salesPct) || 0) / 100;

  const days = useMemo(
    () => buildForecast({ today: todayStr, horizon, startBalance, weekdayAvg, salesFactor, outflows }),
    [todayStr, horizon, startBalance, weekdayAvg, salesFactor, outflows]
  );
  const weeks = useMemo(() => groupByWeek(days), [days]);
  const { low, firstNegative } = useMemo(() => forecastLows(days), [days]);

  const totalIn = days.reduce((s, d) => s + d.inflow, 0);
  const totalOut = days.reduce((s, d) => s + d.supplierOut + d.chargesOut, 0);
  const endBalance = days.length ? days[days.length - 1].balance : startBalance;
  const horizonEnd = addDays(todayStr, horizon);
  const upcoming = outflows
    .map((o) => ({ ...o, date: o.date <= todayStr ? addDays(todayStr, 1) : o.date, overdue: o.date <= todayStr }))
    .filter((o) => o.date <= horizonEnd)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const avgWeek = weekdayAvg.reduce((s, v) => s + v, 0) * salesFactor;
  const chartData = days.map((d) => ({ day: shortDate(d.date), balance: Math.round(d.balance) }));

  if (loading) return <p className="p-8 text-center text-muted">{t("loading")}</p>;

  return (
    <div>
      {/* Paramètres de la prévision */}
      <div className="card mb-5 grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
        <div>
          <div className="mb-1 text-sm font-medium">{t("fc_horizon")}</div>
          <div className="flex gap-1">
            {HORIZONS.map((h) => (
              <button
                key={h}
                onClick={() => setHorizon(h)}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
                  horizon === h ? "bg-primary text-primary-fg" : "border border-border"
                }`}
              >
                {h} {t("fc_days")}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">{t("fc_start_balance")}</label>
          <input
            type="number"
            className="input"
            value={balanceOverride ?? String(Math.round(computedBalance * 100) / 100)}
            onChange={(e) => setBalanceOverride(e.target.value)}
          />
          <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
            {balanceOverride !== null && (
              <button onClick={() => setBalanceOverride(null)} className="text-primary hover:underline">
                {t("fc_use_computed")}
              </button>
            )}
            {lastStatement && (
              <button
                onClick={() => setBalanceOverride(String(lastStatement.closing_balance))}
                className="text-primary hover:underline"
              >
                {t("fc_use_bank")} ({fmtMoney(Number(lastStatement.closing_balance), lang)}
                {lastStatement.period_end ? ` · ${lastStatement.period_end}` : ""})
              </button>
            )}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">{t("fc_sales_pct")}</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              step={5}
              className="input"
              value={salesPct}
              onChange={(e) => setSalesPct(e.target.value)}
            />
            <span className="text-sm text-muted">%</span>
          </div>
          <p className="mt-1 text-xs text-muted">
            {t("fc_sales_basis")}: {fmtMoney(avgWeek, lang)} / {t("fc_week")}
          </p>
        </div>
      </div>

      {!openingSet && balanceOverride === null && (
        <div className="mb-4 rounded-xl border border-accent/40 bg-accent/5 px-4 py-3 text-sm">
          {t("fc_opening_missing")}
        </div>
      )}

      {/* Alerte solde négatif */}
      {firstNegative ? (
        <div className="mb-5 rounded-xl border border-danger/40 bg-danger/5 px-4 py-3 text-sm">
          <span className="font-semibold text-danger">⚠ {t("fc_negative_from")} <bdi dir="ltr">{firstNegative.date}</bdi></span>
          {low && (
            <span className="text-muted">
              {" "}· {t("fc_lowest")}: <span className="font-medium text-danger">{fmtMoney(low.balance, lang)}</span> (<bdi dir="ltr">{low.date}</bdi>)
            </span>
          )}
        </div>
      ) : (
        <div className="mb-5 rounded-xl border border-success/40 bg-success/5 px-4 py-3 text-sm">
          <span className="font-semibold text-success">✓ {t("fc_stays_positive")}</span>
          {low && (
            <span className="text-muted">
              {" "}· {t("fc_lowest")}: <span className="font-medium">{fmtMoney(low.balance, lang)}</span> (<bdi dir="ltr">{low.date}</bdi>)
            </span>
          )}
        </div>
      )}

      {/* KPI */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("fc_current_balance")} value={fmtMoney(startBalance, lang)} />
        <Kpi label={t("fc_expected_in")} value={`+ ${fmtMoney(totalIn, lang)}`} accent="success" />
        <Kpi label={t("fc_expected_out")} value={`− ${fmtMoney(totalOut, lang)}`} accent="danger" />
        <Kpi
          label={`${t("fc_end_balance")} (${shortDate(horizonEnd)})`}
          value={fmtMoney(endBalance, lang)}
          accent={endBalance >= 0 ? "primary" : "danger"}
        />
      </div>

      {/* Courbe */}
      <div className="card mb-5 p-4" dir="ltr">
        <h2 className="font-bold">{t("fc_chart_title")}</h2>
        <p className="mb-2 text-xs text-muted">{t("fc_hint")}</p>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            <defs>
              <linearGradient id="fcGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={SERIES.ca} stopOpacity={0.25} />
                <stop offset="100%" stopColor={SERIES.ca} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={INK.grid} vertical={false} />
            <XAxis dataKey="day" tick={{ fill: INK.secondary, fontSize: 12 }} tickLine={false}
              axisLine={{ stroke: INK.grid }} interval="preserveStartEnd" minTickGap={24} />
            <YAxis tick={{ fill: INK.secondary, fontSize: 12 }} tickLine={false} axisLine={false} width={70}
              domain={[(min: number) => Math.min(0, min), (max: number) => Math.max(0, max)]}
              tickFormatter={(v) => new Intl.NumberFormat("fr").format(v as number)} />
            <ReferenceLine y={0} stroke={STATUS.critical} strokeDasharray="4 4" />
            <Tooltip content={<FcTooltip lang={lang} />} />
            <Area isAnimationActive={false} type="monotone" dataKey="balance" stroke={SERIES.ca} strokeWidth={2} fill="url(#fcGrad)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* Par semaine */}
        <div className="card overflow-x-auto lg:col-span-3">
          <h2 className="px-4 pt-4 font-bold">{t("fc_by_week")}</h2>
          <table className="mt-2 w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="px-4 py-2 text-start font-medium">{t("fc_week")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("fc_sales")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("nav_suppliers")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("total_charges")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("fc_end_balance")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {weeks.map((w) => (
                <tr key={w.start}>
                  <td className="whitespace-nowrap px-4 py-2.5">{shortDate(w.start)} → {shortDate(w.end)}</td>
                  <td className="px-4 py-2.5 text-end text-success">+ {fmtMoney(w.inflow, lang)}</td>
                  <td className="px-4 py-2.5 text-end">{w.supplierOut ? `− ${fmtMoney(w.supplierOut, lang)}` : "—"}</td>
                  <td className="px-4 py-2.5 text-end">{w.chargesOut ? `− ${fmtMoney(w.chargesOut, lang)}` : "—"}</td>
                  <td className={`px-4 py-2.5 text-end font-semibold ${w.endBalance < 0 ? "text-danger" : ""}`}>
                    {fmtMoney(w.endBalance, lang)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Décaissements prévus */}
        <div className="card lg:col-span-2">
          <h2 className="px-4 pt-4 font-bold">{t("fc_upcoming_out")}</h2>
          {upcoming.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted">{t("fc_no_outflows")}</p>
          ) : (
            <ul className="mt-2 divide-y divide-border text-sm">
              {upcoming.map((o, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{o.label}</div>
                    <div className="text-xs text-muted">
                      {o.overdue ? <span className="text-danger">{t("due_overdue")}</span> : shortDate(o.date)}
                      {" · "}
                      {o.kind === "supplier" ? t("fc_supplier_due") : t("fc_monthly_charges")}
                    </div>
                  </div>
                  <span className="whitespace-nowrap font-semibold">− {fmtMoney(o.amount, lang)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: "primary" | "success" | "danger" }) {
  const color = accent === "primary" ? "text-primary" : accent === "success" ? "text-success" : accent === "danger" ? "text-danger" : "text-foreground";
  return (
    <div className="card p-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={`mt-1 text-xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

function FcTooltip({ active, payload, label, lang }: {
  active?: boolean; payload?: { value: number }[]; label?: string; lang: "fr" | "ar";
}) {
  if (!active || !payload?.length) return null;
  const v = payload[0].value;
  return (
    <div className="rounded-lg border border-border bg-surface p-2.5 text-xs shadow-sm">
      <div className="mb-0.5 text-muted">{label}</div>
      <div style={{ color: v < 0 ? STATUS.critical : INK.primary }} className="font-semibold">{fmtMoney(v, lang)}</div>
    </div>
  );
}
