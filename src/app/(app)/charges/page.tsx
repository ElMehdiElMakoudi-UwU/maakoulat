"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { currentMonth, fmtMoney, fmtNum, monthLabel, monthRange } from "@/lib/format";
import { fetchAll } from "@/lib/demandData";
import { catKey, commissionsBySeller, rateMap } from "@/lib/commissions";
import type { Charge, CommissionRate, Seller } from "@/lib/types";

interface SaleRow { seller_id: string; product_id: string; quantity: number; sale_price: number }

export default function ChargesPage() {
  const { t, lang } = useI18n();
  const supabase = useMemo(() => createClient(), []);
  const [month, setMonth] = useState(currentMonth());
  const [charges, setCharges] = useState<Charge[]>([]);
  const [loading, setLoading] = useState(true);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [productCat, setProductCat] = useState<Record<string, string | null>>({});
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [rates, setRates] = useState<CommissionRate[]>([]);
  const [ratesMissing, setRatesMissing] = useState(false);
  const [form, setForm] = useState({ label: "", amount: "", type: "recurring" as "recurring" | "one_off" });

  async function reload() {
    setLoading(true);
    // charges fixes (month = null) + ponctuelles du mois sélectionné
    const { data } = await supabase
      .from("charges")
      .select("*")
      .or(`month.is.null,month.eq.${month}`)
      .order("sort_order");
    setCharges((data as Charge[]) ?? []);

    // Commissions : ventes du mois + catégories produits + taux
    const { start, end } = monthRange(month);
    const [selRes, prodRes, rateRes, saleRows] = await Promise.all([
      supabase.from("sellers").select("*").order("sort_order"),
      fetchAll<{ id: string; category: string | null }>((a, b) =>
        supabase.from("products").select("id,category").order("id").range(a, b)),
      supabase.from("commission_rates").select("category,rate"),
      fetchAll<SaleRow>((a, b) =>
        supabase.from("sales").select("seller_id,product_id,quantity,sale_price")
          .gte("sale_date", start).lt("sale_date", end).order("id").range(a, b)),
    ]);
    setSellers((selRes.data as Seller[]) ?? []);
    setProductCat(Object.fromEntries(prodRes.map((p) => [p.id, p.category])));
    setRatesMissing(!!rateRes.error);
    setRates((rateRes.data as CommissionRate[]) ?? []);
    setSales(saleRows);
    setLoading(false);
  }
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const fixedTotal = charges.filter((c) => c.active).reduce((s, c) => s + Number(c.amount), 0);

  const commissions = useMemo(
    () => commissionsBySeller(sales, sellers, (id) => productCat[id], rateMap(rates)),
    [sales, sellers, productCat, rates]
  );
  const commissionTotal = commissions.reduce((s, c) => s + c.commission, 0);
  const total = fixedTotal + commissionTotal;
  const sellerName = (id: string) => sellers.find((s) => s.id === id)?.name ?? "—";

  // Toutes les catégories du catalogue (dédoublonnées sans casse), avec leur taux
  const categories = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of Object.values(productCat)) {
      const label = (c ?? "").trim();
      if (label && !map.has(catKey(label))) map.set(catKey(label), label);
    }
    for (const r of rates) if (!map.has(catKey(r.category))) map.set(catKey(r.category), r.category.trim());
    const rm = rateMap(rates);
    return [...map.entries()]
      .map(([key, label]) => ({ key, label, rate: rm.get(key) ?? 0 }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [productCat, rates]);

  async function saveRate(label: string, value: string) {
    const rate = Math.min(100, Math.max(0, parseFloat(value) || 0));
    const existing = rates.find((r) => catKey(r.category) === catKey(label));
    const category = existing?.category ?? label;
    setRates((old) => [...old.filter((r) => catKey(r.category) !== catKey(label)), { category, rate }]);
    await supabase.from("commission_rates").upsert({ category, rate, updated_at: new Date().toISOString() });
  }

  async function updateField(c: Charge, field: "label" | "amount", value: string) {
    const patch = field === "amount" ? { amount: parseFloat(value) || 0 } : { label: value };
    setCharges((old) => old.map((x) => (x.id === c.id ? { ...x, ...patch } : x)));
    await supabase.from("charges").update(patch).eq("id", c.id);
  }
  async function toggle(c: Charge) {
    setCharges((old) => old.map((x) => (x.id === c.id ? { ...x, active: !x.active } : x)));
    await supabase.from("charges").update({ active: !c.active }).eq("id", c.id);
  }
  async function add() {
    if (!form.label) return;
    const maxOrder = charges.reduce((m, c) => Math.max(m, c.sort_order), 0);
    await supabase.from("charges").insert({
      label: form.label,
      amount: parseFloat(form.amount) || 0,
      month: form.type === "one_off" ? month : null,
      sort_order: maxOrder + 1,
    });
    setForm({ label: "", amount: "", type: form.type });
    reload();
  }
  async function remove(id: string) {
    if (!confirm(t("confirm_delete"))) return;
    await supabase.from("charges").delete().eq("id", id);
    setCharges((old) => old.filter((c) => c.id !== id));
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("charges_title")}</h1>
          <p className="text-sm capitalize text-muted">{monthLabel(month, lang)}</p>
        </div>
        <div className="flex items-center gap-3">
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-2 outline-none focus:border-primary" />
          <div className="text-end">
            <div className="text-xs text-muted">{t("total_charges")}</div>
            <div className="text-xl font-bold text-danger">{fmtMoney(total, lang)}</div>
          </div>
        </div>
      </div>

      <div className="card mb-4 grid gap-2 p-4 sm:grid-cols-5">
        <input className="input sm:col-span-2" placeholder={t("label")} value={form.label}
          onChange={(e) => setForm({ ...form, label: e.target.value })} />
        <input className="input" type="number" placeholder={t("amount")} value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        <select className="input" value={form.type}
          onChange={(e) => setForm({ ...form, type: e.target.value as "recurring" | "one_off" })}>
          <option value="recurring">{t("recurring")}</option>
          <option value="one_off">{t("one_off")}</option>
        </select>
        <button onClick={add} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg">
          + {t("add_charge")}
        </button>
      </div>

      <h2 className="mb-2 font-bold">{t("fixed_charges")}</h2>
      <div className="card overflow-hidden">
        {loading ? (
          <p className="p-8 text-center text-muted">{t("loading")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="px-4 py-2 text-start font-medium">{t("label")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("charge_type")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("amount")}</th>
                <th className="px-4 py-2 text-center font-medium">{t("actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {charges.map((c) => (
                <tr key={c.id} className={c.active ? "" : "opacity-40"}>
                  <td className="px-4 py-2">
                    <input defaultValue={c.label} onBlur={(e) => updateField(c, "label", e.target.value)}
                      className="w-full rounded border border-transparent bg-transparent px-1 py-1 hover:border-border focus:border-primary focus:outline-none" />
                  </td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      c.month ? "bg-accent/15 text-accent" : "bg-primary/10 text-primary"
                    }`}>
                      {c.month ? t("one_off_short") : t("recurring_short")}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-end">
                    <input type="number" defaultValue={c.amount} onBlur={(e) => updateField(c, "amount", e.target.value)}
                      className="w-28 rounded border border-transparent bg-transparent px-1 py-1 text-end hover:border-border focus:border-primary focus:outline-none" />
                  </td>
                  <td className="px-4 py-2 text-center">
                    <button onClick={() => toggle(c)} title="on/off" className="me-3 text-muted hover:text-foreground">
                      {c.active ? "🟢" : "⚪"}
                    </button>
                    <button onClick={() => remove(c.id)} className="text-danger hover:underline">✕</button>
                  </td>
                </tr>
              ))}
              {charges.length === 0 && (
                <tr><td colSpan={4} className="p-6 text-center text-muted">{t("no_data")}</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-background font-bold">
                <td className="px-4 py-2.5" colSpan={2}>{t("total")}</td>
                <td className="px-4 py-2.5 text-end">{fmtMoney(fixedTotal, lang)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* Commissions vendeurs (calculées) */}
      <div className="mb-2 mt-6 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold">{t("commissions")}</h2>
        <p className="text-xs text-muted">{t("commissions_hint")}</p>
      </div>
      {ratesMissing && (
        <p className="mb-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          Table <code>commission_rates</code> introuvable — exécutez <code>supabase/migration_commissions.sql</code> dans Supabase.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card overflow-hidden lg:col-span-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="px-4 py-2 text-start font-medium">{t("seller")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("category")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("commission_base")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("commission_rate")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("commission")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {commissions.map((c) => (
                <Fragment key={c.seller_id}>
                  {c.byCategory.map((b, i) => (
                    <tr key={`${c.seller_id}-${b.category}`}>
                      <td className="px-4 py-2 font-medium">{i === 0 ? sellerName(c.seller_id) : ""}</td>
                      <td className="px-4 py-2" dir="auto">{b.category || t("no_category")}</td>
                      <td className="px-4 py-2 text-end">{fmtMoney(b.base, lang)}</td>
                      <td className="px-4 py-2 text-end">{fmtNum(b.rate, lang)} %</td>
                      <td className="px-4 py-2 text-end">{fmtMoney(b.commission, lang)}</td>
                    </tr>
                  ))}
                  <tr className="bg-background">
                    <td className="px-4 py-2 font-semibold" colSpan={2}>
                      {sellerName(c.seller_id)}{" "}
                      <span className="ms-1 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">{t("auto_short")}</span>
                    </td>
                    <td className="px-4 py-2 text-end font-semibold">{fmtMoney(c.base, lang)}</td>
                    <td></td>
                    <td className="px-4 py-2 text-end font-semibold">{fmtMoney(c.commission, lang)}</td>
                  </tr>
                </Fragment>
              ))}
              {commissions.length === 0 && (
                <tr><td colSpan={5} className="p-6 text-center text-muted">{t("no_data")}</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-background font-bold">
                <td className="px-4 py-2.5" colSpan={4}>{t("total")}</td>
                <td className="px-4 py-2.5 text-end">{fmtMoney(commissionTotal, lang)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="card overflow-hidden">
          <h3 className="border-b border-border px-4 py-2.5 text-sm font-semibold">{t("commission_rates")}</h3>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {categories.map((c) => (
                <tr key={c.key}>
                  <td className="px-4 py-1.5" dir="auto">{c.label}</td>
                  <td className="px-4 py-1.5 text-end">
                    <input type="number" min={0} max={100} step={0.5} defaultValue={c.rate || ""} placeholder="0"
                      disabled={ratesMissing}
                      onBlur={(e) => { if ((parseFloat(e.target.value) || 0) !== c.rate) saveRate(c.label, e.target.value); }}
                      className="w-20 rounded border border-border bg-transparent px-2 py-1 text-end focus:border-primary focus:outline-none" /> %
                  </td>
                </tr>
              ))}
              {categories.length === 0 && (
                <tr><td colSpan={2} className="p-4 text-center text-muted">{t("no_data")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
