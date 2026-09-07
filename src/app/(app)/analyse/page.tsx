"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { currentMonth, fmtMoney, fmtNum, fmtPct, monthLabel, monthRange } from "@/lib/format";
import { SERIES, SELLER_HUES, STATUS, INK } from "@/lib/chartColors";
import type { Product, Seller } from "@/lib/types";

interface SaleRow {
  product_id: string;
  seller_id: string;
  sale_date: string;
  quantity: number;
  purchase_price: number;
  sale_price: number;
}

// Renvoie les N derniers mois (YYYY-MM) se terminant à `endMonth`
function lastMonths(endMonth: string, n: number): string[] {
  const [y, m] = endMonth.split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export default function AnalysePage() {
  const { t, lang } = useI18n();
  const supabase = useMemo(() => createClient(), []);
  const [month, setMonth] = useState(currentMonth());
  const [threshold, setThreshold] = useState(0.05); // marge plancher (5%)
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [products, setProducts] = useState<Record<string, Product>>({});
  const [sales, setSales] = useState<SaleRow[]>([]); // 6 derniers mois
  const [loading, setLoading] = useState(true);

  const months = useMemo(() => lastMonths(month, 6), [month]);

  useEffect(() => {
    setLoading(true);
    const start = monthRange(months[0]).start;
    const end = monthRange(months[months.length - 1]).end;
    (async () => {
      const [sellersRes, prodRes, salesRes] = await Promise.all([
        supabase.from("sellers").select("*").order("sort_order"),
        supabase.from("products").select("*"),
        supabase
          .from("sales")
          .select("product_id,seller_id,sale_date,quantity,purchase_price,sale_price")
          .gte("sale_date", start)
          .lt("sale_date", end),
      ]);
      setSellers((sellersRes.data as Seller[]) ?? []);
      const pmap: Record<string, Product> = {};
      for (const p of (prodRes.data as Product[]) ?? []) pmap[p.id] = p;
      setProducts(pmap);
      setSales((salesRes.data as SaleRow[]) ?? []);
      setLoading(false);
    })();
  }, [supabase, months]);

  const inMonth = useMemo(() => sales.filter((s) => s.sale_date.startsWith(month)), [sales, month]);

  // A) Évolution quotidienne (mois sélectionné)
  const daily = useMemo(() => {
    const map = new Map<number, { ca: number; profit: number }>();
    for (const s of inMonth) {
      const day = Number(s.sale_date.slice(8, 10));
      const cur = map.get(day) ?? { ca: 0, profit: 0 };
      cur.ca += s.quantity * s.sale_price;
      cur.profit += s.quantity * (s.sale_price - s.purchase_price);
      map.set(day, cur);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([day, v]) => ({ day: String(day), ...v }));
  }, [inMonth]);

  // B) Comparaison mensuelle (CA + bénéfice) + par vendeur (CA)
  const monthly = useMemo(() => {
    return months.map((mo) => {
      const rows = sales.filter((s) => s.sale_date.startsWith(mo));
      const row: Record<string, number | string> = { month: monthLabel(mo, lang) };
      let ca = 0,
        profit = 0;
      const perSeller = new Map<string, number>();
      for (const s of rows) {
        const c = s.quantity * s.sale_price;
        ca += c;
        profit += s.quantity * (s.sale_price - s.purchase_price);
        perSeller.set(s.seller_id, (perSeller.get(s.seller_id) ?? 0) + c);
      }
      row.ca = Math.round(ca);
      row.profit = Math.round(profit);
      for (const sel of sellers) row[sel.name] = Math.round(perSeller.get(sel.id) ?? 0);
      return row;
    });
  }, [months, sales, sellers, lang]);

  // C) Alertes marges — produits vendus ce mois avec marge < seuil
  const marginAlerts = useMemo(() => {
    const soldIds = new Set(inMonth.map((s) => s.product_id));
    return Object.values(products)
      .filter((p) => soldIds.has(p.id) && p.sale_price > 0)
      .map((p) => ({ p, margin: (p.sale_price - p.purchase_price) / p.sale_price }))
      .filter((x) => x.margin < threshold)
      .sort((a, b) => a.margin - b.margin);
  }, [products, inMonth, threshold]);

  // D) Best-sellers & produits dormants (mois sélectionné)
  const { best, dormant } = useMemo(() => {
    const agg = new Map<string, { ca: number; qty: number }>();
    for (const s of inMonth) {
      const cur = agg.get(s.product_id) ?? { ca: 0, qty: 0 };
      cur.ca += s.quantity * s.sale_price;
      cur.qty += s.quantity;
      agg.set(s.product_id, cur);
    }
    const best = Array.from(agg.entries())
      .map(([id, v]) => ({ name: products[id]?.name ?? "—", seller: products[id]?.seller_id, ...v }))
      .sort((a, b) => b.ca - a.ca)
      .slice(0, 8);
    const soldIds = new Set(inMonth.map((s) => s.product_id));
    const dormant = Object.values(products)
      .filter((p) => p.active && !soldIds.has(p.id))
      .slice(0, 30);
    return { best, dormant };
  }, [inMonth, products]);

  const sellerName = (id?: string) => sellers.find((s) => s.id === id)?.name ?? "";

  return (
    <div dir="ltr">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3" dir={lang === "ar" ? "rtl" : "ltr"}>
        <div>
          <h1 className="text-2xl font-bold">{t("analysis_title")}</h1>
          <p className="text-sm capitalize text-muted">{monthLabel(month, lang)}</p>
        </div>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2 outline-none focus:border-primary"
        />
      </div>

      {loading ? (
        <p className="p-8 text-center text-muted">{t("loading")}</p>
      ) : (
        <div className="space-y-5">
          {/* A) Évolution quotidienne */}
          <ChartCard title={t("daily_evolution")} hint={t("daily_evolution_hint")}>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={daily} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid stroke={INK.grid} vertical={false} />
                <XAxis dataKey="day" tick={{ fill: INK.secondary, fontSize: 12 }} tickLine={false} axisLine={{ stroke: INK.grid }} />
                <YAxis tick={{ fill: INK.secondary, fontSize: 12 }} tickLine={false} axisLine={false} width={64}
                  tickFormatter={(v) => new Intl.NumberFormat("fr").format(v as number)} />
                <Tooltip content={<MoneyTooltip lang={lang} />} />
                <Legend />
                <Line isAnimationActive={false} type="monotone" dataKey="ca" name={t("ca")} stroke={SERIES.ca} strokeWidth={2} dot={{ r: 3 }} />
                <Line isAnimationActive={false} type="monotone" dataKey="profit" name={t("profit")} stroke={SERIES.profit} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="grid gap-5 lg:grid-cols-2">
            {/* B) Comparaison mensuelle CA/Bénéfice */}
            <ChartCard title={t("monthly_comparison")} hint={t("monthly_comparison_hint")}>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={monthly} margin={{ top: 8, right: 12, left: 4, bottom: 4 }} barGap={4}>
                  <CartesianGrid stroke={INK.grid} vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: INK.secondary, fontSize: 11 }} tickLine={false} axisLine={{ stroke: INK.grid }} />
                  <YAxis tick={{ fill: INK.secondary, fontSize: 12 }} tickLine={false} axisLine={false} width={64}
                    tickFormatter={(v) => new Intl.NumberFormat("fr").format(v as number)} />
                  <Tooltip content={<MoneyTooltip lang={lang} />} />
                  <Legend />
                  <Bar isAnimationActive={false} dataKey="ca" name={t("ca")} fill={SERIES.ca} radius={[4, 4, 0, 0]} />
                  <Bar isAnimationActive={false} dataKey="profit" name={t("profit")} fill={SERIES.profit} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* B bis) CA par vendeur et par mois (empilé) */}
            <ChartCard title={t("seller_comparison")}>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={monthly} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                  <CartesianGrid stroke={INK.grid} vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: INK.secondary, fontSize: 11 }} tickLine={false} axisLine={{ stroke: INK.grid }} />
                  <YAxis tick={{ fill: INK.secondary, fontSize: 12 }} tickLine={false} axisLine={false} width={64}
                    tickFormatter={(v) => new Intl.NumberFormat("fr").format(v as number)} />
                  <Tooltip content={<MoneyTooltip lang={lang} />} />
                  <Legend />
                  {sellers.map((s, i) => (
                    <Bar isAnimationActive={false} key={s.id} dataKey={s.name} stackId="ca" fill={SELLER_HUES[i % SELLER_HUES.length]}
                      radius={i === sellers.length - 1 ? [4, 4, 0, 0] : undefined} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* C) Alertes marges */}
          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <h2 className="font-bold">⚠️ {t("margin_alerts")}</h2>
                <p className="text-xs text-muted">{t("margin_alerts_hint")}</p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                {t("threshold")}
                <select value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}
                  className="rounded-lg border border-border bg-surface px-2 py-1">
                  <option value={0.03}>3%</option>
                  <option value={0.05}>5%</option>
                  <option value={0.08}>8%</option>
                  <option value={0.1}>10%</option>
                </select>
              </label>
            </div>
            {marginAlerts.length === 0 ? (
              <p className="p-6 text-center text-success">{t("no_alerts")}</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted">
                    <th className="px-4 py-2 text-start font-medium">{t("product")}</th>
                    <th className="px-4 py-2 text-start font-medium">{t("seller")}</th>
                    <th className="px-4 py-2 text-end font-medium">{t("purchase_price")}</th>
                    <th className="px-4 py-2 text-end font-medium">{t("sale_price")}</th>
                    <th className="px-4 py-2 text-end font-medium">{t("margin")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {marginAlerts.map(({ p, margin }) => (
                    <tr key={p.id}>
                      <td className="px-4 py-2.5">{p.name}</td>
                      <td className="px-4 py-2.5 text-muted">{sellerName(p.seller_id)}</td>
                      <td className="px-4 py-2.5 text-end">{fmtNum(p.purchase_price, lang)}</td>
                      <td className="px-4 py-2.5 text-end">{fmtNum(p.sale_price, lang)}</td>
                      <td className="px-4 py-2.5 text-end font-semibold"
                        style={{ color: margin < 0 ? STATUS.critical : STATUS.warning }}>
                        {fmtPct(margin, lang)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {/* D) Best-sellers */}
            <div className="card overflow-hidden">
              <h2 className="border-b border-border px-4 py-3 font-bold">🏆 {t("best_sellers")}</h2>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border">
                  {best.map((b, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2.5">{b.name}</td>
                      <td className="px-4 py-2.5 text-end text-muted">{fmtNum(b.qty, lang)} {t("units")}</td>
                      <td className="px-4 py-2.5 text-end font-semibold">{fmtMoney(b.ca, lang)}</td>
                    </tr>
                  ))}
                  {best.length === 0 && <tr><td className="p-6 text-center text-muted">{t("no_data")}</td></tr>}
                </tbody>
              </table>
            </div>

            {/* D bis) Produits dormants */}
            <div className="card overflow-hidden">
              <h2 className="border-b border-border px-4 py-3 font-bold">😴 {t("dormant_products")}</h2>
              <div className="max-h-[360px] overflow-y-auto">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-border">
                    {dormant.map((p) => (
                      <tr key={p.id}>
                        <td className="px-4 py-2.5">{p.name}</td>
                        <td className="px-4 py-2.5 text-end text-muted">{sellerName(p.seller_id)}</td>
                      </tr>
                    ))}
                    {dormant.length === 0 && <tr><td className="p-6 text-center text-muted">{t("no_data")}</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ChartCard({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <h2 className="font-bold">{title}</h2>
      {hint && <p className="mb-2 text-xs text-muted">{hint}</p>}
      <div className={hint ? "" : "mt-2"}>{children}</div>
    </div>
  );
}

interface TooltipEntry {
  name: string;
  value: number;
  color: string;
}
function MoneyTooltip({ active, payload, label, lang }: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
  lang: "fr" | "ar";
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface p-2.5 text-xs shadow-sm">
      <div className="mb-1 font-semibold" style={{ color: INK.primary }}>{label}</div>
      {payload.map((e, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: e.color }} />
          <span style={{ color: INK.secondary }}>{e.name}</span>
          <span className="ms-auto font-semibold" style={{ color: INK.primary }}>{fmtMoney(e.value, lang)}</span>
        </div>
      ))}
    </div>
  );
}
