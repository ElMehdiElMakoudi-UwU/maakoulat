"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { currentMonth, fmtMoney, fmtNum, fmtPct, monthLabel, monthRange } from "@/lib/format";
import type { Seller } from "@/lib/types";

interface Prod { id: string; name: string; category: string | null; seller_id: string }
interface Sale { product_id: string; seller_id: string; sale_date: string; quantity: number; purchase_price: number; sale_price: number }

export default function RapportsPage() {
  const { t, lang } = useI18n();
  const supabase = useMemo(() => createClient(), []);
  const [month, setMonth] = useState(currentMonth());
  const [sellerId, setSellerId] = useState<string>("all");
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [products, setProducts] = useState<Prod[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const { start, end } = monthRange(month);
    (async () => {
      const [selRes, prodRes, salesRes] = await Promise.all([
        supabase.from("sellers").select("*").order("sort_order"),
        supabase.from("products").select("id,name,category,seller_id"),
        supabase.from("sales").select("product_id,seller_id,sale_date,quantity,purchase_price,sale_price")
          .gte("sale_date", start).lt("sale_date", end),
      ]);
      setSellers((selRes.data as Seller[]) ?? []);
      setProducts((prodRes.data as Prod[]) ?? []);
      setSales((salesRes.data as Sale[]) ?? []);
      setLoading(false);
    })();
  }, [supabase, month]);

  const prodName = (id: string) => products.find((p) => p.id === id)?.name ?? "—";
  const prodCat = (id: string) => products.find((p) => p.id === id)?.category ?? "—";
  const sellerName = (id: string) => sellers.find((s) => s.id === id)?.name ?? "—";

  const scoped = useMemo(
    () => (sellerId === "all" ? sales : sales.filter((s) => s.seller_id === sellerId)),
    [sales, sellerId]
  );

  // Agrégat par vendeur (pour la vue "Tous")
  const perSeller = useMemo(() => {
    const m = new Map<string, { ca: number; profit: number; qty: number }>();
    for (const s of sales) {
      const cur = m.get(s.seller_id) ?? { ca: 0, profit: 0, qty: 0 };
      cur.ca += s.quantity * s.sale_price;
      cur.profit += s.quantity * (s.sale_price - s.purchase_price);
      cur.qty += s.quantity;
      m.set(s.seller_id, cur);
    }
    return sellers.map((s) => ({ seller: s, ...(m.get(s.id) ?? { ca: 0, profit: 0, qty: 0 }) }));
  }, [sales, sellers]);

  // Agrégat produits (scope courant)
  const perProduct = useMemo(() => {
    const m = new Map<string, { ca: number; profit: number; qty: number }>();
    for (const s of scoped) {
      const cur = m.get(s.product_id) ?? { ca: 0, profit: 0, qty: 0 };
      cur.ca += s.quantity * s.sale_price;
      cur.profit += s.quantity * (s.sale_price - s.purchase_price);
      cur.qty += s.quantity;
      m.set(s.product_id, cur);
    }
    return Array.from(m.entries()).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.ca - a.ca);
  }, [scoped]);

  // Agrégat par jour (scope courant)
  const perDay = useMemo(() => {
    const m = new Map<string, { ca: number; profit: number; qty: number }>();
    for (const s of scoped) {
      const cur = m.get(s.sale_date) ?? { ca: 0, profit: 0, qty: 0 };
      cur.ca += s.quantity * s.sale_price;
      cur.profit += s.quantity * (s.sale_price - s.purchase_price);
      cur.qty += s.quantity;
      m.set(s.sale_date, cur);
    }
    return Array.from(m.entries()).map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date));
  }, [scoped]);

  const tot = useMemo(() => {
    let ca = 0, profit = 0, qty = 0;
    for (const s of scoped) {
      ca += s.quantity * s.sale_price;
      profit += s.quantity * (s.sale_price - s.purchase_price);
      qty += s.quantity;
    }
    return { ca, profit, qty, margin: ca ? profit / ca : 0 };
  }, [scoped]);

  function exportCsv() {
    const sep = ";";
    const head = ["Vendeur", "Catégorie", "Produit", "Quantité", "PU achat", "PU vente", "CA", "Bénéfice"];
    const lines = perProduct.map((p) => {
      const sid = products.find((x) => x.id === p.id)?.seller_id ?? "";
      const pu = p.qty ? (p.ca / p.qty) : 0;
      const pa = p.qty ? ((p.ca - p.profit) / p.qty) : 0;
      return [sellerName(sid), prodCat(p.id), prodName(p.id), p.qty, pa.toFixed(2), pu.toFixed(2), p.ca.toFixed(2), p.profit.toFixed(2)]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`).join(sep);
    });
    const totalLine = ["", "", "TOTAL", tot.qty, "", "", tot.ca.toFixed(2), tot.profit.toFixed(2)]
      .map((c) => `"${c}"`).join(sep);
    const csv = "﻿" + [head.map((h) => `"${h}"`).join(sep), ...lines, totalLine].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const who = sellerId === "all" ? "tous" : sellerName(sellerId).replace(/\s+/g, "-");
    a.download = `rapport-${who}-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const fmtDate = (d: string) =>
    new Intl.DateTimeFormat(lang === "ar" ? "ar-MA" : "fr-FR", { day: "2-digit", month: "short" }).format(new Date(d + "T00:00:00"));
  const genDate = new Intl.DateTimeFormat(lang === "ar" ? "ar-MA" : "fr-FR", { dateStyle: "long" }).format(new Date());

  return (
    <div>
      {/* Barre d'outils (non imprimée) */}
      <div className="no-print mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("reports_title")}</h1>
          <p className="text-sm text-muted">{t("reports_hint")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={sellerId} onChange={(e) => setSellerId(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary">
            <option value="all">{t("all_sellers")}</option>
            {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-2 outline-none focus:border-primary" />
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
          {/* En-tête du rapport */}
          <div className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-xl font-bold">{t("report_title")}</h2>
                <p className="text-sm text-muted">
                  {t("period")} : <span className="capitalize">{monthLabel(month, lang)}</span>
                  {" · "}
                  {sellerId === "all" ? t("all_sellers") : sellerName(sellerId)}
                </p>
              </div>
              <div className="text-end text-xs text-muted">
                <div className="font-bold text-primary">Maakoulat</div>
                <div>{t("generated_on")} {genDate}</div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label={t("ca")} value={fmtMoney(tot.ca, lang)} color="text-primary" />
              <Stat label={t("profit")} value={fmtMoney(tot.profit, lang)} color="text-success" />
              <Stat label={t("margin_rate")} value={fmtPct(tot.margin, lang)} />
              <Stat label={t("items_sold")} value={fmtNum(tot.qty, lang)} />
            </div>
          </div>

          {/* Vue "Tous" : comparaison vendeurs */}
          {sellerId === "all" && (
            <div className="card overflow-x-auto">
              <div className="border-b border-border px-4 py-2.5 font-bold">{t("seller_comparison")}</div>
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-border text-muted">
                    <th className="px-4 py-2 text-start font-medium">{t("seller")}</th>
                    <th className="px-4 py-2 text-end font-medium">{t("ca")}</th>
                    <th className="px-4 py-2 text-end font-medium">{t("profit")}</th>
                    <th className="px-4 py-2 text-end font-medium">{t("margin_rate")}</th>
                    <th className="px-4 py-2 text-end font-medium">{t("items_sold")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {perSeller.map((r) => (
                    <tr key={r.seller.id}>
                      <td className="px-4 py-2.5 font-medium">{r.seller.name}</td>
                      <td className="px-4 py-2.5 text-end font-semibold">{fmtMoney(r.ca, lang)}</td>
                      <td className="px-4 py-2.5 text-end text-success">{fmtMoney(r.profit, lang)}</td>
                      <td className="px-4 py-2.5 text-end">{fmtPct(r.ca ? r.profit / r.ca : 0, lang)}</td>
                      <td className="px-4 py-2.5 text-end">{fmtNum(r.qty, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Meilleurs produits */}
          <div className="card overflow-x-auto">
            <div className="border-b border-border px-4 py-2.5 font-bold">{t("top_products")}</div>
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className="px-4 py-2 text-start font-medium">{t("rank")}</th>
                  <th className="px-4 py-2 text-start font-medium">{t("product")}</th>
                  <th className="px-4 py-2 text-end font-medium">{t("quantity")}</th>
                  <th className="px-4 py-2 text-end font-medium">{t("ca")}</th>
                  <th className="px-4 py-2 text-end font-medium">{t("profit")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {perProduct.slice(0, 15).map((p, i) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2.5 text-muted">{i + 1}</td>
                    <td className="px-4 py-2.5 font-medium">{prodName(p.id)}</td>
                    <td className="px-4 py-2.5 text-end">{fmtNum(p.qty, lang)}</td>
                    <td className="px-4 py-2.5 text-end font-semibold">{fmtMoney(p.ca, lang)}</td>
                    <td className="px-4 py-2.5 text-end text-success">{fmtMoney(p.profit, lang)}</td>
                  </tr>
                ))}
                {perProduct.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted">{t("no_data")}</td></tr>}
              </tbody>
            </table>
          </div>

          {/* Détail par jour */}
          <div className="card overflow-x-auto">
            <div className="border-b border-border px-4 py-2.5 font-bold">{t("daily_detail")}</div>
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className="px-4 py-2 text-start font-medium">{t("date")}</th>
                  <th className="px-4 py-2 text-end font-medium">{t("items_sold")}</th>
                  <th className="px-4 py-2 text-end font-medium">{t("ca")}</th>
                  <th className="px-4 py-2 text-end font-medium">{t("profit")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {perDay.map((d) => (
                  <tr key={d.date}>
                    <td className="px-4 py-2.5 font-medium capitalize">{fmtDate(d.date)}</td>
                    <td className="px-4 py-2.5 text-end">{fmtNum(d.qty, lang)}</td>
                    <td className="px-4 py-2.5 text-end font-semibold">{fmtMoney(d.ca, lang)}</td>
                    <td className="px-4 py-2.5 text-end text-success">{fmtMoney(d.profit, lang)}</td>
                  </tr>
                ))}
                {perDay.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-muted">{t("no_data")}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={`mt-0.5 text-lg font-bold ${color ?? "text-foreground"}`}>{value}</div>
    </div>
  );
}
