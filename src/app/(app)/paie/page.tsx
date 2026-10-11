"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { currentMonth, fmtMoney, fmtNum, monthLabel, monthRange } from "@/lib/format";
import { fetchAll } from "@/lib/demandData";
import { catKey, earnsCommission, rateMap } from "@/lib/commissions";
import { COMPANY } from "@/lib/company";
import type { CommissionRate, Seller } from "@/lib/types";

interface Prod { id: string; name: string; category: string | null; unit: string | null }
interface SaleRow { product_id: string; quantity: number; sale_price: number }

export default function PaiePage() {
  const { t, lang } = useI18n();
  const supabase = useMemo(() => createClient(), []);
  const [month, setMonth] = useState(currentMonth());
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [sellerId, setSellerId] = useState("");
  const [products, setProducts] = useState<Record<string, Prod>>({});
  const [rates, setRates] = useState<CommissionRate[]>([]);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Données indépendantes du mois / vendeur
  useEffect(() => {
    (async () => {
      const [selRes, prod, rateRes] = await Promise.all([
        supabase.from("sellers").select("*").order("sort_order"),
        fetchAll<Prod>((a, b) => supabase.from("products").select("id,name,category,unit").order("id").range(a, b)),
        supabase.from("commission_rates").select("category,rate"),
      ]);
      const list = ((selRes.data as Seller[]) ?? []).filter((s) => s.active);
      setSellers(list);
      setSellerId((cur) => cur || list[0]?.id || "");
      setProducts(Object.fromEntries(prod.map((p) => [p.id, p])));
      setRates((rateRes.data as CommissionRate[]) ?? []);
    })();
  }, [supabase]);

  // Ventes du vendeur pour le mois
  useEffect(() => {
    if (!sellerId) return;
    let cancelled = false;
    const { start, end } = monthRange(month);
    (async () => {
      setLoading(true);
      const rows = await fetchAll<SaleRow>((a, b) =>
        supabase.from("sales").select("product_id,quantity,sale_price")
          .eq("seller_id", sellerId).gte("sale_date", start).lt("sale_date", end)
          .order("id").range(a, b)
      );
      if (cancelled) return;
      setSales(rows);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase, sellerId, month]);

  const seller = sellers.find((s) => s.id === sellerId) ?? null;
  const migrationMissing = !!seller && seller.base_salary === undefined;
  const baseSalary = Number(seller?.base_salary ?? 0);

  // Une ligne par produit : Σ qté, Σ HT, commission selon le taux de la catégorie
  const lines = useMemo(() => {
    const rm = rateMap(rates);
    const eligible = !!seller && earnsCommission(seller);
    const map = new Map<string, { qty: number; ht: number }>();
    for (const s of sales) {
      const cur = map.get(s.product_id) ?? { qty: 0, ht: 0 };
      cur.qty += Number(s.quantity);
      cur.ht += Number(s.quantity) * Number(s.sale_price);
      map.set(s.product_id, cur);
    }
    return [...map.entries()]
      .filter(([, v]) => v.qty !== 0)
      .map(([id, v]) => {
        const p = products[id];
        const rate = eligible ? rm.get(catKey(p?.category)) ?? 0 : 0;
        return {
          id,
          name: p?.name ?? "—",
          category: p?.category ?? "",
          unit: p?.unit ?? "",
          qty: v.qty,
          pu: v.qty ? v.ht / v.qty : 0,
          ht: v.ht,
          rate,
          commission: (v.ht * rate) / 100,
        };
      })
      .sort((a, b) => a.category.localeCompare(b.category) || b.ht - a.ht);
  }, [sales, products, rates, seller]);

  const totalHt = lines.reduce((s, l) => s + l.ht, 0);
  const totalCommission = lines.reduce((s, l) => s + l.commission, 0);
  const totalSalary = baseSalary + totalCommission;

  async function saveBase(value: string) {
    if (!seller || migrationMissing) return;
    const v = Math.max(0, parseFloat(value) || 0);
    if (v === baseSalary) return;
    setSellers((old) => old.map((s) => (s.id === seller.id ? { ...s, base_salary: v } : s)));
    await supabase.from("sellers").update({ base_salary: v }).eq("id", seller.id);
  }

  return (
    <div>
      {/* Contrôles (non imprimés) */}
      <div className="no-print mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("payroll_title")}</h1>
          <p className="text-sm capitalize text-muted">{monthLabel(month, lang)}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-muted">{t("seller")}</span>
            <select className="input" value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
              {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted">{t("month")}</span>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="input" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted">{t("base_salary")}</span>
            <input key={`${sellerId}-${baseSalary}`} type="number" min={0} className="input w-36 text-end"
              defaultValue={baseSalary || ""} placeholder="0"
              disabled={migrationMissing}
              onBlur={(e) => saveBase(e.target.value)} />
          </label>
          <button onClick={() => window.print()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg">
            🖨️ {t("print_pdf")}
          </button>
        </div>
      </div>
      {migrationMissing && (
        <p className="no-print mb-4 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {t("payroll_migration_missing")}
        </p>
      )}

      {/* Bulletin imprimable */}
      <div className="print-area card p-5">
        <div className="mb-4 flex items-center justify-between gap-4 border-b-2 border-primary pb-3">
          <div>
            <div className="text-lg font-bold tracking-wide text-primary">{COMPANY.name}</div>
            <div className="text-xs text-muted">{COMPANY.address} — {COMPANY.tel}</div>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={COMPANY.logoPath} alt="Maakoulatcom" className="h-16 w-auto" />
        </div>

        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">{t("payslip")}</h2>
            <p className="text-sm capitalize text-muted">{monthLabel(month, lang)}</p>
          </div>
          <div className="text-end">
            <div className="text-xs text-muted">{t("seller")}</div>
            <div className="text-lg font-bold">{seller?.name ?? "—"}</div>
          </div>
        </div>

        <h3 className="mb-2 text-sm font-semibold">{t("sales_of_month")}</h3>
        {loading ? (
          <p className="p-6 text-center text-muted">{t("loading")}</p>
        ) : (
          <table className="mb-2 w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="px-2 py-1.5 text-start font-medium">{t("product")}</th>
                <th className="px-2 py-1.5 text-start font-medium">{t("category")}</th>
                <th className="px-2 py-1.5 text-end font-medium">{t("quantity")}</th>
                <th className="px-2 py-1.5 text-end font-medium">{t("unit_price_ht")}</th>
                <th className="px-2 py-1.5 text-end font-medium">{t("total_ht")}</th>
                <th className="px-2 py-1.5 text-end font-medium">{t("commission_rate")}</th>
                <th className="px-2 py-1.5 text-end font-medium">{t("commission")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-2 py-1.5" dir="auto">{l.name}{l.unit ? ` (${l.unit})` : ""}</td>
                  <td className="px-2 py-1.5" dir="auto">{l.category || t("no_category")}</td>
                  <td className="px-2 py-1.5 text-end">{fmtNum(l.qty, lang)}</td>
                  <td className="px-2 py-1.5 text-end">{fmtMoney(l.pu, lang)}</td>
                  <td className="px-2 py-1.5 text-end">{fmtMoney(l.ht, lang)}</td>
                  <td className="px-2 py-1.5 text-end">{l.rate ? `${fmtNum(l.rate, lang)} %` : "—"}</td>
                  <td className="px-2 py-1.5 text-end">{l.commission ? fmtMoney(l.commission, lang) : "—"}</td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr><td colSpan={7} className="p-6 text-center text-muted">{t("no_data")}</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border font-bold">
                <td className="px-2 py-2" colSpan={4}>{t("total")}</td>
                <td className="px-2 py-2 text-end">{fmtMoney(totalHt, lang)}</td>
                <td></td>
                <td className="px-2 py-2 text-end">{fmtMoney(totalCommission, lang)}</td>
              </tr>
            </tfoot>
          </table>
        )}
        <p className="mb-5 text-xs text-muted">
          {seller && !earnsCommission(seller) ? t("no_commission_seller") : t("amounts_ht_note")}
        </p>

        {/* Récapitulatif salaire */}
        <div className="ms-auto max-w-sm rounded-lg border border-border">
          <div className="flex justify-between px-4 py-2 text-sm">
            <span>{t("base_salary")}</span>
            <span>{fmtMoney(baseSalary, lang)}</span>
          </div>
          <div className="flex justify-between border-t border-border px-4 py-2 text-sm">
            <span>{t("commission")}</span>
            <span>{fmtMoney(totalCommission, lang)}</span>
          </div>
          <div className="flex justify-between border-t-2 border-primary px-4 py-2.5 font-bold">
            <span>{t("total_salary")}</span>
            <span className="text-primary">{fmtMoney(totalSalary, lang)}</span>
          </div>
        </div>

        <div className="mt-12 grid grid-cols-2 gap-8 text-sm">
          <div className="border-t border-border pt-2 text-center text-muted">{t("signature_employer")}</div>
          <div className="border-t border-border pt-2 text-center text-muted">{t("signature_seller")}</div>
        </div>

        <div className="mt-8 border-t border-border pt-2 text-center text-[10px] text-muted">
          {COMPANY.address} — RC {COMPANY.rc} — Patente {COMPANY.patente} — IF {COMPANY.if} — ICE {COMPANY.ice}
        </div>
      </div>
    </div>
  );
}
