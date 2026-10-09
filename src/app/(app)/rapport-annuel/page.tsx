"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { fmtMoney, fmtNum, fmtPct, today, ttc } from "@/lib/format";
import { fetchAll } from "@/lib/demandData";
import { SERIES, INK } from "@/lib/chartColors";
import type { Charge, Seller, Supplier, SupplierInvoice, SupplierPayment } from "@/lib/types";

interface Prod { id: string; name: string; category: string | null; vat_rate: number }
interface Sale { product_id: string; seller_id: string; sale_date: string; quantity: number; purchase_price: number; sale_price: number }

const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));

export default function RapportAnnuelPage() {
  const { t, lang } = useI18n();
  const supabase = useMemo(() => createClient(), []);
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [products, setProducts] = useState<Record<string, Prod>>({});
  const [sales, setSales] = useState<Sale[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([]);
  const [payments, setPayments] = useState<SupplierPayment[]>([]);
  const [loading, setLoading] = useState(true);

  // Données indépendantes de l'année (catalogue, charges, dettes fournisseurs)
  useEffect(() => {
    (async () => {
      const [sel, prod, ch, sup, inv, pay] = await Promise.all([
        fetchAll<Seller>((a, b) => supabase.from("sellers").select("*").order("sort_order").range(a, b)),
        fetchAll<Prod>((a, b) => supabase.from("products").select("id,name,category,vat_rate").range(a, b)),
        fetchAll<Charge>((a, b) => supabase.from("charges").select("*").range(a, b)),
        fetchAll<Supplier>((a, b) => supabase.from("suppliers").select("*").order("sort_order").range(a, b)),
        fetchAll<SupplierInvoice>((a, b) => supabase.from("supplier_invoices").select("*").order("id").range(a, b)),
        fetchAll<SupplierPayment>((a, b) => supabase.from("supplier_payments").select("*").order("id").range(a, b)),
      ]);
      setSellers(sel);
      const pmap: Record<string, Prod> = {};
      for (const p of prod) pmap[p.id] = p;
      setProducts(pmap);
      setCharges(ch);
      setSuppliers(sup);
      setInvoices(inv);
      setPayments(pay);
    })();
  }, [supabase]);

  // Ventes de l'année (peut dépasser 1000 lignes → pagination)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await fetchAll<Sale>((a, b) =>
        supabase
          .from("sales")
          .select("product_id,seller_id,sale_date,quantity,purchase_price,sale_price")
          .gte("sale_date", `${year}-01-01`)
          .lt("sale_date", `${year + 1}-01-01`)
          .order("id")
          .range(a, b)
      );
      if (cancelled) return;
      setSales(rows);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase, year]);

  const caOf = (s: Sale) => s.quantity * ttc(s.sale_price, products[s.product_id]?.vat_rate ?? 0);
  const profitOf = (s: Sale) => s.quantity * (s.sale_price - s.purchase_price);

  // Mois pris en compte pour les charges fixes : du premier mois avec ventes
  // jusqu'au mois courant (année en cours) ou décembre (année passée).
  const chargedMonths = useMemo(() => {
    const todayStr = today();
    const lastMonth = year < thisYear ? 12 : year === thisYear ? Number(todayStr.slice(5, 7)) : 0;
    const firstSale = sales.reduce<string | null>((m, s) => (m === null || s.sale_date < m ? s.sale_date : m), null);
    const firstMonth = firstSale ? Number(firstSale.slice(5, 7)) : lastMonth + 1;
    const set = new Set<string>();
    for (let m = firstMonth; m <= lastMonth; m++) set.add(`${year}-${String(m).padStart(2, "0")}`);
    return set;
  }, [sales, year, thisYear]);

  const monthly = useMemo(() => {
    const recurring = charges.filter((c) => c.active && c.month === null).reduce((s, c) => s + Number(c.amount), 0);
    return MONTHS.map((mm) => {
      const key = `${year}-${mm}`;
      let ca = 0, profit = 0, qty = 0;
      for (const s of sales) {
        if (!s.sale_date.startsWith(key)) continue;
        ca += caOf(s);
        profit += profitOf(s);
        qty += s.quantity;
      }
      const oneOff = charges.filter((c) => c.active && c.month === key).reduce((s, c) => s + Number(c.amount), 0);
      const ch = oneOff + (chargedMonths.has(key) ? recurring : 0);
      const purchases = invoices.filter((i) => i.inv_date.startsWith(key)).reduce((s, i) => s + Number(i.amount), 0);
      const paid = payments.filter((p) => p.pay_date.startsWith(key)).reduce((s, p) => s + Number(p.amount), 0);
      return { key, ca, profit, qty, charges: ch, net: profit - ch, purchases, paid };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales, charges, invoices, payments, products, year, chargedMonths]);

  const tot = useMemo(() => {
    const sum = (k: "ca" | "profit" | "qty" | "charges" | "net" | "purchases" | "paid") =>
      monthly.reduce((s, m) => s + m[k], 0);
    const ca = sum("ca");
    const profit = sum("profit");
    const active = monthly.filter((m) => m.ca > 0);
    const best = active.reduce<(typeof monthly)[number] | null>((b, m) => (!b || m.ca > b.ca ? m : b), null);
    return {
      ca, profit, qty: sum("qty"), charges: sum("charges"), net: sum("net"),
      purchases: sum("purchases"), paid: sum("paid"),
      margin: ca ? profit / ca : 0,
      avgMonth: active.length ? ca / active.length : 0,
      activeMonths: active.length,
      best,
    };
  }, [monthly]);

  const perSeller = useMemo(() => {
    const m = new Map<string, { ca: number; profit: number; qty: number }>();
    for (const s of sales) {
      const cur = m.get(s.seller_id) ?? { ca: 0, profit: 0, qty: 0 };
      cur.ca += caOf(s);
      cur.profit += profitOf(s);
      cur.qty += s.quantity;
      m.set(s.seller_id, cur);
    }
    return sellers
      .map((s) => ({ seller: s, ...(m.get(s.id) ?? { ca: 0, profit: 0, qty: 0 }) }))
      .filter((r) => r.ca > 0 || r.seller.active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales, sellers, products]);

  const perProduct = useMemo(() => {
    const m = new Map<string, { ca: number; profit: number; qty: number }>();
    for (const s of sales) {
      const cur = m.get(s.product_id) ?? { ca: 0, profit: 0, qty: 0 };
      cur.ca += caOf(s);
      cur.profit += profitOf(s);
      cur.qty += s.quantity;
      m.set(s.product_id, cur);
    }
    return Array.from(m.entries()).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.ca - a.ca);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales, products]);

  const perCategory = useMemo(() => {
    const m = new Map<string, { ca: number; profit: number }>();
    for (const p of perProduct) {
      const cat = products[p.id]?.category || "—";
      const cur = m.get(cat) ?? { ca: 0, profit: 0 };
      cur.ca += p.ca;
      cur.profit += p.profit;
      m.set(cat, cur);
    }
    return Array.from(m.entries()).map(([cat, v]) => ({ cat, ...v })).sort((a, b) => b.ca - a.ca);
  }, [perProduct, products]);

  // Situation fournisseurs : achats et paiements de l'année + reste dû à la clôture
  // (31/12, ou aujourd'hui pour l'année en cours).
  const perSupplier = useMemo(() => {
    const cutoff = year < thisYear ? `${year}-12-31` : today();
    const inYear = (d: string) => d.startsWith(`${year}-`);
    return suppliers
      .map((sup) => {
        const inv = invoices.filter((i) => i.supplier_id === sup.id);
        const pay = payments.filter((p) => p.supplier_id === sup.id);
        const purchases = inv.filter((i) => inYear(i.inv_date)).reduce((s, i) => s + Number(i.amount), 0);
        const paid = pay.filter((p) => inYear(p.pay_date)).reduce((s, p) => s + Number(p.amount), 0);
        const due =
          inv.filter((i) => i.inv_date <= cutoff).reduce((s, i) => s + Number(i.amount), 0) -
          pay.filter((p) => p.pay_date <= cutoff).reduce((s, p) => s + Number(p.amount), 0);
        return { sup, purchases, paid, due };
      })
      .filter((r) => r.purchases > 0.005 || r.paid > 0.005 || Math.abs(r.due) > 0.005)
      .sort((a, b) => b.purchases - a.purchases);
  }, [suppliers, invoices, payments, year, thisYear]);

  const supTot = useMemo(
    () => perSupplier.reduce((s, r) => ({ purchases: s.purchases + r.purchases, paid: s.paid + r.paid, due: s.due + r.due }),
      { purchases: 0, paid: 0, due: 0 }),
    [perSupplier]
  );

  const monthName = (key: string, style: "long" | "short" = "long") => {
    const [y, m] = key.split("-").map(Number);
    return new Intl.DateTimeFormat(lang === "ar" ? "ar-MA" : "fr-FR", { month: style }).format(new Date(y, m - 1, 1));
  };

  const chartData = monthly.map((m) => ({
    month: monthName(m.key, "short"),
    ca: Math.round(m.ca),
    profit: Math.round(m.profit),
    net: Math.round(m.net),
  }));

  const years = useMemo(() => {
    const out: number[] = [];
    for (let y = thisYear; y >= thisYear - 5; y--) out.push(y);
    return out;
  }, [thisYear]);

  function exportCsv() {
    const sep = ";";
    const q = (c: string | number) => `"${String(c).replace(/"/g, '""')}"`;
    const head = ["Mois", "CA TTC", "Bénéfice brut", "Marge", "Charges", "Résultat net", "Achats fournisseurs", "Paiements fournisseurs", "Quantité"];
    const lines = monthly.map((m) =>
      [m.key, m.ca.toFixed(2), m.profit.toFixed(2), m.ca ? ((m.profit / m.ca) * 100).toFixed(2) + "%" : "", m.charges.toFixed(2),
        m.net.toFixed(2), m.purchases.toFixed(2), m.paid.toFixed(2), m.qty].map(q).join(sep)
    );
    const total = ["TOTAL", tot.ca.toFixed(2), tot.profit.toFixed(2), (tot.margin * 100).toFixed(2) + "%", tot.charges.toFixed(2),
      tot.net.toFixed(2), tot.purchases.toFixed(2), tot.paid.toFixed(2), tot.qty].map(q).join(sep);
    const csv = "﻿" + [head.map(q).join(sep), ...lines, total].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rapport-annuel-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const genDate = new Intl.DateTimeFormat(lang === "ar" ? "ar-MA" : "fr-FR", { dateStyle: "long" }).format(new Date());
  const th = "px-3 py-2 font-medium";
  const td = "px-3 py-2";

  return (
    <div>
      {/* Barre d'outils (non imprimée) */}
      <div className="no-print mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("annual_title")}</h1>
          <p className="text-sm text-muted">{t("annual_hint")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={year} onChange={(e) => { setLoading(true); setYear(Number(e.target.value)); }}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={exportCsv} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium hover:bg-background">
            ⬇️ {t("export_csv")}
          </button>
          <button onClick={() => window.print()} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg">
            🖨️ {t("print_pdf")}
          </button>
        </div>
      </div>
      <p className="no-print mb-4 text-xs text-muted">{t("share_hint")}</p>

      {loading ? (
        <p className="p-8 text-center text-muted">{t("loading")}</p>
      ) : (
        <div className="print-area space-y-5">
          {/* En-tête + KPI */}
          <div className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-xl font-bold">{t("annual_report_title")} {year}</h2>
                <p className="text-sm text-muted">
                  {t("period")} : 01/01/{year} – 31/12/{year}
                  {tot.activeMonths > 0 && <> · {fmtNum(tot.activeMonths, lang)} {t("annual_active_months")}</>}
                </p>
              </div>
              <div className="text-end text-xs text-muted">
                <div className="font-bold text-primary">Maakoulat</div>
                <div>{t("generated_on")} {genDate}</div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label={t("revenue")} value={fmtMoney(tot.ca, lang)} color="text-primary" />
              <Stat label={t("gross_profit")} value={fmtMoney(tot.profit, lang)} color="text-success" />
              <Stat label={t("total_charges")} value={fmtMoney(tot.charges, lang)} />
              <Stat label={t("net_result")} value={fmtMoney(tot.net, lang)} color={tot.net >= 0 ? "text-success" : "text-danger"} />
              <Stat label={t("margin_rate")} value={fmtPct(tot.margin, lang)} />
              <Stat label={t("annual_avg_month")} value={fmtMoney(tot.avgMonth, lang)} />
              <Stat label={t("annual_best_month")}
                value={tot.best ? `${monthName(tot.best.key)} · ${fmtMoney(tot.best.ca, lang)}` : "—"} small />
              <Stat label={t("items_sold")} value={fmtNum(tot.qty, lang)} />
            </div>
          </div>

          {/* Graphique mensuel */}
          <div className="card p-4" dir="ltr">
            <h2 className="font-bold" dir={lang === "ar" ? "rtl" : "ltr"}>{t("annual_monthly_chart")}</h2>
            <div className="mt-2">
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 4 }} barGap={2}>
                  <CartesianGrid stroke={INK.grid} vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: INK.secondary, fontSize: 11 }} tickLine={false} axisLine={{ stroke: INK.grid }} />
                  <YAxis tick={{ fill: INK.secondary, fontSize: 12 }} tickLine={false} axisLine={false} width={64}
                    tickFormatter={(v) => new Intl.NumberFormat("fr").format(v as number)} />
                  <Tooltip content={<MoneyTooltip lang={lang} />} />
                  <Legend />
                  <Bar isAnimationActive={false} dataKey="ca" name={t("ca")} fill={SERIES.ca} radius={[4, 4, 0, 0]} />
                  <Bar isAnimationActive={false} dataKey="profit" name={t("gross_profit")} fill={SERIES.profit} radius={[4, 4, 0, 0]} />
                  <Line isAnimationActive={false} type="monotone" dataKey="net" name={t("net_result")} stroke={SERIES.third} strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Tableau mois par mois */}
          <div className="card overflow-x-auto">
            <div className="border-b border-border px-4 py-2.5">
              <div className="font-bold">{t("annual_by_month")}</div>
              <p className="text-xs text-muted">{t("annual_charges_hint")}</p>
            </div>
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className={`${th} text-start`}>{t("month")}</th>
                  <th className={`${th} text-end`}>{t("ca")}</th>
                  <th className={`${th} text-end`}>{t("gross_profit")}</th>
                  <th className={`${th} text-end`}>{t("margin")}</th>
                  <th className={`${th} text-end`}>{t("total_charges")}</th>
                  <th className={`${th} text-end`}>{t("net_result")}</th>
                  <th className={`${th} text-end`}>{t("annual_purchases")}</th>
                  <th className={`${th} text-end`}>{t("suppliers_paid")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {monthly.map((m) => {
                  const empty = m.ca === 0 && m.charges === 0 && m.purchases === 0 && m.paid === 0;
                  return (
                    <tr key={m.key} className={empty ? "text-muted" : ""}>
                      <td className={`${td} font-medium capitalize`}>{monthName(m.key)}</td>
                      <td className={`${td} text-end font-semibold`}>{fmtMoney(m.ca, lang)}</td>
                      <td className={`${td} text-end text-success`}>{fmtMoney(m.profit, lang)}</td>
                      <td className={`${td} text-end`}>{m.ca ? fmtPct(m.profit / m.ca, lang) : "—"}</td>
                      <td className={`${td} text-end`}>{fmtMoney(m.charges, lang)}</td>
                      <td className={`${td} text-end font-semibold ${m.net < 0 ? "text-danger" : "text-success"}`}>{fmtMoney(m.net, lang)}</td>
                      <td className={`${td} text-end`}>{fmtMoney(m.purchases, lang)}</td>
                      <td className={`${td} text-end`}>{fmtMoney(m.paid, lang)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-background font-bold">
                  <td className={td}>{t("total")}</td>
                  <td className={`${td} text-end`}>{fmtMoney(tot.ca, lang)}</td>
                  <td className={`${td} text-end text-success`}>{fmtMoney(tot.profit, lang)}</td>
                  <td className={`${td} text-end`}>{fmtPct(tot.margin, lang)}</td>
                  <td className={`${td} text-end`}>{fmtMoney(tot.charges, lang)}</td>
                  <td className={`${td} text-end ${tot.net < 0 ? "text-danger" : "text-success"}`}>{fmtMoney(tot.net, lang)}</td>
                  <td className={`${td} text-end`}>{fmtMoney(tot.purchases, lang)}</td>
                  <td className={`${td} text-end`}>{fmtMoney(tot.paid, lang)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {/* Par vendeur */}
            <div className="card overflow-x-auto">
              <div className="border-b border-border px-4 py-2.5 font-bold">{t("by_seller")}</div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted">
                    <th className={`${th} text-start`}>{t("seller")}</th>
                    <th className={`${th} text-end`}>{t("ca")}</th>
                    <th className={`${th} text-end`}>{t("profit")}</th>
                    <th className={`${th} text-end`}>{t("annual_share")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {perSeller.map((r) => (
                    <tr key={r.seller.id}>
                      <td className={`${td} font-medium`}>{r.seller.name}</td>
                      <td className={`${td} text-end font-semibold`}>{fmtMoney(r.ca, lang)}</td>
                      <td className={`${td} text-end text-success`}>{fmtMoney(r.profit, lang)}</td>
                      <td className={`${td} text-end`}>{fmtPct(tot.ca ? r.ca / tot.ca : 0, lang)}</td>
                    </tr>
                  ))}
                  {perSeller.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-muted">{t("no_data")}</td></tr>}
                </tbody>
              </table>
            </div>

            {/* Par catégorie */}
            <div className="card overflow-x-auto">
              <div className="border-b border-border px-4 py-2.5 font-bold">{t("annual_by_category")}</div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted">
                    <th className={`${th} text-start`}>{t("category")}</th>
                    <th className={`${th} text-end`}>{t("ca")}</th>
                    <th className={`${th} text-end`}>{t("profit")}</th>
                    <th className={`${th} text-end`}>{t("annual_share")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {perCategory.map((c) => (
                    <tr key={c.cat}>
                      <td className={`${td} font-medium`}>{c.cat}</td>
                      <td className={`${td} text-end font-semibold`}>{fmtMoney(c.ca, lang)}</td>
                      <td className={`${td} text-end text-success`}>{fmtMoney(c.profit, lang)}</td>
                      <td className={`${td} text-end`}>{fmtPct(tot.ca ? c.ca / tot.ca : 0, lang)}</td>
                    </tr>
                  ))}
                  {perCategory.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-muted">{t("no_data")}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* Meilleurs produits de l'année */}
          <div className="card overflow-x-auto">
            <div className="border-b border-border px-4 py-2.5 font-bold">{t("top_products")}</div>
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className={`${th} text-start`}>{t("rank")}</th>
                  <th className={`${th} text-start`}>{t("product")}</th>
                  <th className={`${th} text-end`}>{t("quantity")}</th>
                  <th className={`${th} text-end`}>{t("ca")}</th>
                  <th className={`${th} text-end`}>{t("profit")}</th>
                  <th className={`${th} text-end`}>{t("margin")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {perProduct.slice(0, 20).map((p, i) => (
                  <tr key={p.id}>
                    <td className={`${td} text-muted`}>{i + 1}</td>
                    <td className={`${td} font-medium`}>{products[p.id]?.name ?? "—"}</td>
                    <td className={`${td} text-end`}>{fmtNum(p.qty, lang)}</td>
                    <td className={`${td} text-end font-semibold`}>{fmtMoney(p.ca, lang)}</td>
                    <td className={`${td} text-end text-success`}>{fmtMoney(p.profit, lang)}</td>
                    <td className={`${td} text-end`}>{fmtPct(p.ca ? p.profit / p.ca : 0, lang)}</td>
                  </tr>
                ))}
                {perProduct.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted">{t("no_data")}</td></tr>}
              </tbody>
            </table>
          </div>

          {/* Situation fournisseurs */}
          <div className="card overflow-x-auto">
            <div className="border-b border-border px-4 py-2.5">
              <div className="font-bold">{t("annual_suppliers")}</div>
              <p className="text-xs text-muted">{year < thisYear ? t("annual_due_hint_past") : t("annual_due_hint_current")}</p>
            </div>
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className={`${th} text-start`}>{t("supplier")}</th>
                  <th className={`${th} text-end`}>{t("annual_purchases")}</th>
                  <th className={`${th} text-end`}>{t("suppliers_paid")}</th>
                  <th className={`${th} text-end`}>{t("annual_remaining_due")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {perSupplier.map((r) => (
                  <tr key={r.sup.id}>
                    <td className={`${td} font-medium`}>{r.sup.name}</td>
                    <td className={`${td} text-end`}>{fmtMoney(r.purchases, lang)}</td>
                    <td className={`${td} text-end`}>{fmtMoney(r.paid, lang)}</td>
                    <td className={`${td} text-end font-semibold ${r.due > 0.005 ? "text-danger" : ""}`}>{fmtMoney(r.due, lang)}</td>
                  </tr>
                ))}
                {perSupplier.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-muted">{t("no_data")}</td></tr>}
              </tbody>
              {perSupplier.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-border bg-background font-bold">
                    <td className={td}>{t("total")}</td>
                    <td className={`${td} text-end`}>{fmtMoney(supTot.purchases, lang)}</td>
                    <td className={`${td} text-end`}>{fmtMoney(supTot.paid, lang)}</td>
                    <td className={`${td} text-end ${supTot.due > 0.005 ? "text-danger" : ""}`}>{fmtMoney(supTot.due, lang)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color, small }: { label: string; value: string; color?: string; small?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={`mt-0.5 font-bold capitalize ${small ? "text-sm" : "text-lg"} ${color ?? "text-foreground"}`}>{value}</div>
    </div>
  );
}

interface TooltipEntry { name: string; value: number; color: string }
function MoneyTooltip({ active, payload, label, lang }: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
  lang: "fr" | "ar";
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface p-2.5 text-xs shadow-sm">
      <div className="mb-1 font-semibold capitalize" style={{ color: INK.primary }}>{label}</div>
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
