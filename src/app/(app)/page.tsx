"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { currentMonth, fmtMoney, fmtNum, fmtPct, monthLabel, monthRange, today, ttc } from "@/lib/format";
import type { Product, Seller, Supplier, SupplierInvoice, SupplierPayment } from "@/lib/types";
import { allocateInvoices, dueSummary } from "@/lib/supplierDues";
import { rateMap, totalCommission } from "@/lib/commissions";
import { totalBonuses, type BonusTier } from "@/lib/bonuses";
import type { CommissionRate } from "@/lib/types";

interface SaleRow {
  product_id: string;
  seller_id: string;
  quantity: number;
  purchase_price: number;
  sale_price: number;
  sale_date: string;
}

export default function DashboardPage() {
  const { t, lang } = useI18n();
  const supabase = useMemo(() => createClient(), []);
  const [month, setMonth] = useState(currentMonth());
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [products, setProducts] = useState<Record<string, Product>>({});
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [payments, setPayments] = useState<number>(0);
  const [charges, setCharges] = useState<number>(0);
  const [rates, setRates] = useState<CommissionRate[]>([]);
  const [tiers, setTiers] = useState<BonusTier[]>([]);
  const [caTarget, setCaTarget] = useState(0);
  const [profitTarget, setProfitTarget] = useState(0);
  const [editTargets, setEditTargets] = useState(false);
  const [caTargetInput, setCaTargetInput] = useState("");
  const [profitTargetInput, setProfitTargetInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [dues, setDues] = useState<ReturnType<typeof dueSummary> | null>(null);

  // Échéances fournisseurs (indépendant du mois affiché)
  useEffect(() => {
    (async () => {
      const [supRes, invRes, payRes] = await Promise.all([
        supabase.from("suppliers").select("id,payment_terms_days"),
        supabase.from("supplier_invoices").select("*"),
        supabase.from("supplier_payments").select("supplier_id,amount"),
      ]);
      setDues(
        dueSummary(
          allocateInvoices(
            (supRes.data as Supplier[]) ?? [],
            (invRes.data as SupplierInvoice[]) ?? [],
            (payRes.data as SupplierPayment[]) ?? [],
            today()
          )
        )
      );
    })();
  }, [supabase]);

  useEffect(() => {
    setLoading(true);
    const { start, end } = monthRange(month);
    (async () => {
      const [sellersRes, prodRes, salesRes, payRes, chargeRes, setRes, rateRes, tierRes] = await Promise.all([
        supabase.from("sellers").select("*").order("sort_order"),
        supabase.from("products").select("id,name,category,vat_rate"),
        supabase
          .from("sales")
          .select("product_id,seller_id,quantity,purchase_price,sale_price,sale_date")
          .gte("sale_date", start)
          .lt("sale_date", end),
        supabase.from("supplier_payments").select("amount").gte("pay_date", start).lt("pay_date", end),
        supabase.from("charges").select("amount,month,active"),
        supabase.from("monthly_settings").select("*").eq("month", month).maybeSingle(),
        supabase.from("commission_rates").select("category,rate"),
        supabase.from("seller_bonus_tiers").select("*").eq("month", month),
      ]);
      setTiers((tierRes.data as BonusTier[]) ?? []);
      setRates((rateRes.data as CommissionRate[]) ?? []);
      const settings = setRes.data as { ca_target: number; profit_target: number } | null;
      setCaTarget(settings ? Number(settings.ca_target) : 0);
      setProfitTarget(settings ? Number(settings.profit_target) : 0);
      setCaTargetInput(settings && settings.ca_target ? String(settings.ca_target) : "");
      setProfitTargetInput(settings && settings.profit_target ? String(settings.profit_target) : "");
      setSellers((sellersRes.data as Seller[]) ?? []);
      const pmap: Record<string, Product> = {};
      for (const p of (prodRes.data as Product[]) ?? []) pmap[p.id] = p;
      setProducts(pmap);
      setSales((salesRes.data as SaleRow[]) ?? []);
      setPayments(
        ((payRes.data as { amount: number }[]) ?? []).reduce((s, r) => s + Number(r.amount), 0)
      );
      const ch = ((chargeRes.data as { amount: number; month: string | null; active: boolean }[]) ?? [])
        .filter((c) => c.active && (c.month === month || c.month === null))
        .reduce((s, r) => s + Number(r.amount), 0);
      setCharges(ch);
      setLoading(false);
    })();
  }, [supabase, month]);

  // Agrégats par vendeur
  const perSeller = useMemo(() => {
    const map = new Map<string, { ca: number; profit: number }>();
    for (const s of sales) {
      const cur = map.get(s.seller_id) ?? { ca: 0, profit: 0 };
      cur.ca += s.quantity * ttc(s.sale_price, products[s.product_id]?.vat_rate ?? 0);
      cur.profit += s.quantity * (s.sale_price - s.purchase_price);
      map.set(s.seller_id, cur);
    }
    return sellers.map((s) => ({
      seller: s,
      ...(map.get(s.id) ?? { ca: 0, profit: 0 }),
    }));
  }, [sales, sellers, products]);

  const totals = useMemo(() => {
    const ca = perSeller.reduce((s, r) => s + r.ca, 0);
    const profit = perSeller.reduce((s, r) => s + r.profit, 0);
    return { ca, profit, margin: ca ? profit / ca : 0 };
  }, [perSeller]);

  const commissions = useMemo(
    () => totalCommission(sales, sellers, (id) => products[id]?.category, rateMap(rates)),
    [sales, sellers, products, rates]
  );
  const bonuses = useMemo(() => totalBonuses(sales, tiers), [sales, tiers]);
  const netResult = totals.profit - charges - commissions - bonuses;

  // Seuil de rentabilité : coûts fixes (charges + primes) ÷ taux de marge sur
  // coûts variables ((bénéfice brut − commissions) / CA). Exprimé en CA TTC,
  // comme le CA affiché ; au seuil, le résultat net vaut 0.
  const breakeven = useMemo(() => {
    const fixed = charges + bonuses;
    const rate = totals.ca > 0 ? (totals.profit - commissions) / totals.ca : 0;
    const ca = rate > 0 ? fixed / rate : null;
    const [y, m] = month.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const cur = currentMonth();
    const elapsed = month === cur ? new Date().getDate() : month < cur ? daysInMonth : 0;

    // Jour où le CA cumulé franchit le seuil
    let reachedOn: string | null = null;
    if (ca !== null) {
      const byDay = new Map<string, number>();
      for (const s of sales)
        byDay.set(s.sale_date, (byDay.get(s.sale_date) ?? 0) + s.quantity * ttc(s.sale_price, products[s.product_id]?.vat_rate ?? 0));
      let cum = 0;
      for (const d of [...byDay.keys()].sort()) {
        cum += byDay.get(d)!;
        if (cum >= ca) { reachedOn = d; break; }
      }
    }

    // Projection au rythme actuel (mois en cours uniquement)
    let projectedDay: number | null = null;
    let dailyNeeded: number | null = null;
    if (ca !== null && !reachedOn && month === cur && elapsed > 0) {
      const avg = totals.ca / elapsed;
      projectedDay = avg > 0 ? Math.ceil(ca / avg) : null;
      const left = daysInMonth - elapsed;
      dailyNeeded = left > 0 ? (ca - totals.ca) / left : null;
    }
    return {
      fixed, rate, ca, reachedOn, projectedDay, dailyNeeded, daysInMonth,
      isCurrent: month === cur, isPast: month < cur,
    };
  }, [charges, bonuses, commissions, totals, sales, products, month]);

  async function saveTargets() {
    const ca = parseFloat(caTargetInput) || 0;
    const pr = parseFloat(profitTargetInput) || 0;
    await supabase.from("monthly_settings").upsert(
      { month, ca_target: ca, profit_target: pr },
      { onConflict: "month" }
    );
    setCaTarget(ca);
    setProfitTarget(pr);
    setEditTargets(false);
  }

  const topProducts = useMemo(() => {
    const map = new Map<string, { ca: number; qty: number }>();
    for (const s of sales) {
      const cur = map.get(s.product_id) ?? { ca: 0, qty: 0 };
      cur.ca += s.quantity * ttc(s.sale_price, products[s.product_id]?.vat_rate ?? 0);
      cur.qty += s.quantity;
      map.set(s.product_id, cur);
    }
    return Array.from(map.entries())
      .map(([id, v]) => ({ name: products[id]?.name ?? "—", ...v }))
      .sort((a, b) => b.ca - a.ca)
      .slice(0, 8);
  }, [sales, products]);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("dashboard_title")}</h1>
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
        <>
          {/* Alerte échéances fournisseurs */}
          {dues && (dues.overdue > 0.005 || dues.dueSoon > 0.005) && (
            <Link
              href="/fournisseurs"
              className={`mb-5 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3 text-sm ${
                dues.overdue > 0.005 ? "border-danger/40 bg-danger/5" : "border-accent/40 bg-accent/5"
              }`}
            >
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-semibold">⏰ {t("due_alert_title")}</span>
                {dues.overdue > 0.005 && (
                  <span className="font-medium text-danger">
                    {fmtMoney(dues.overdue, lang)} {t("due_alert_overdue")} ({fmtNum(dues.overdueCount, lang)})
                  </span>
                )}
                {dues.dueSoon > 0.005 && (
                  <span className="font-medium text-accent">
                    {fmtMoney(dues.dueSoon, lang)} {t("due_alert_soon")} ({fmtNum(dues.dueSoonCount, lang)})
                  </span>
                )}
              </span>
              <span className="text-primary">{t("see_schedule")}</span>
            </Link>
          )}

          {/* KPI principaux */}
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label={t("revenue")} value={fmtMoney(totals.ca, lang)} accent="primary" />
            <Kpi label={t("gross_profit")} value={fmtMoney(totals.profit, lang)} accent="success" />
            <Kpi label={t("margin")} value={fmtPct(totals.margin, lang)} />
            <Kpi
              label={t("net_result")}
              value={fmtMoney(netResult, lang)}
              accent={netResult >= 0 ? "success" : "danger"}
            />
          </div>

          {/* Seuil de rentabilité */}
          <BreakevenCard be={breakeven} ca={totals.ca} month={month} lang={lang} t={t} />

          {/* Objectifs du mois */}
          <div className="card mb-5 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold">🎯 {t("targets")}</h2>
              <button onClick={() => setEditTargets((e) => !e)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-background">
                {t("set_targets")}
              </button>
            </div>
            {editTargets ? (
              <div className="grid gap-2 sm:grid-cols-3">
                <input type="number" value={caTargetInput} onChange={(e) => setCaTargetInput(e.target.value)}
                  placeholder={t("ca_target")} className="input" />
                <input type="number" value={profitTargetInput} onChange={(e) => setProfitTargetInput(e.target.value)}
                  placeholder={t("profit_target")} className="input" />
                <button onClick={saveTargets} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg">
                  {t("save")}
                </button>
              </div>
            ) : caTarget > 0 || profitTarget > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Progress label={t("ca_target")} current={totals.ca} target={caTarget} lang={lang} tOf={t("of_target")} />
                <Progress label={t("profit_target")} current={totals.profit} target={profitTarget} lang={lang} tOf={t("of_target")} />
              </div>
            ) : (
              <p className="text-sm text-muted">{t("set_targets")} —</p>
            )}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {/* Par vendeur */}
            <div className="card overflow-hidden">
              <h2 className="border-b border-border px-4 py-3 font-bold">{t("by_seller")}</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted">
                    <th className="px-4 py-2 text-start font-medium">{t("seller")}</th>
                    <th className="px-4 py-2 text-end font-medium">{t("ca")}</th>
                    <th className="px-4 py-2 text-end font-medium">{t("profit")}</th>
                    <th className="px-4 py-2 text-end font-medium">{t("margin")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {perSeller.map((r) => (
                    <tr key={r.seller.id}>
                      <td className="px-4 py-2.5 font-medium">{r.seller.name}</td>
                      <td className="px-4 py-2.5 text-end">{fmtMoney(r.ca, lang)}</td>
                      <td className="px-4 py-2.5 text-end text-success">{fmtMoney(r.profit, lang)}</td>
                      <td className="px-4 py-2.5 text-end">{fmtPct(r.ca ? r.profit / r.ca : 0, lang)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-background font-bold">
                    <td className="px-4 py-2.5">{t("total")}</td>
                    <td className="px-4 py-2.5 text-end">{fmtMoney(totals.ca, lang)}</td>
                    <td className="px-4 py-2.5 text-end text-success">{fmtMoney(totals.profit, lang)}</td>
                    <td className="px-4 py-2.5 text-end">{fmtPct(totals.margin, lang)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Résultat */}
            <div className="card p-4">
              <h2 className="mb-3 font-bold">{t("net_result")}</h2>
              <Line label={t("gross_profit")} value={fmtMoney(totals.profit, lang)} positive />
              <Line label={t("suppliers_paid")} value={fmtMoney(payments, lang)} muted />
              <Line label={t("fixed_charges")} value={`− ${fmtMoney(charges, lang)}`} />
              <Line label={t("commissions")} value={`− ${fmtMoney(commissions, lang)}`} />
              <Line label={t("bonuses")} value={`− ${fmtMoney(bonuses, lang)}`} />
              <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                <span className="font-bold">{t("net_result")}</span>
                <span className={`text-xl font-bold ${netResult >= 0 ? "text-success" : "text-danger"}`}>
                  {fmtMoney(netResult, lang)}
                </span>
              </div>
              <p className="mt-2 text-xs text-muted">
                {t("net_result")} = {t("gross_profit")} − {t("fixed_charges")} − {t("commissions")} − {t("bonuses")}
              </p>
            </div>
          </div>

          {/* Top produits */}
          <div className="card mt-5 overflow-hidden">
            <h2 className="border-b border-border px-4 py-3 font-bold">{t("top_products")}</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted">
                  <th className="px-4 py-2 text-start font-medium">{t("product")}</th>
                  <th className="px-4 py-2 text-end font-medium">{t("quantity")}</th>
                  <th className="px-4 py-2 text-end font-medium">{t("ca")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {topProducts.map((p, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2.5">{p.name}</td>
                    <td className="px-4 py-2.5 text-end">{fmtNum(p.qty, lang)}</td>
                    <td className="px-4 py-2.5 text-end font-medium">{fmtMoney(p.ca, lang)}</td>
                  </tr>
                ))}
                {topProducts.length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-6 text-center text-muted">
                      {t("no_data")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function BreakevenCard({
  be,
  ca,
  month,
  lang,
  t,
}: {
  be: {
    fixed: number; rate: number; ca: number | null; reachedOn: string | null;
    projectedDay: number | null; dailyNeeded: number | null; daysInMonth: number;
    isCurrent: boolean; isPast: boolean;
  };
  ca: number;
  month: string;
  lang: "fr" | "ar";
  t: (k: string) => string;
}) {
  const dayLabel = (iso: string) =>
    new Intl.DateTimeFormat(lang === "ar" ? "ar-MA" : "fr-FR", { day: "numeric", month: "long" }).format(new Date(iso + "T00:00:00"));

  if (be.ca === null) {
    return (
      <div className="card mb-5 p-4">
        <h2 className="mb-2 font-bold">⚖️ {t("breakeven")}</h2>
        <p className="text-sm text-muted">{t("breakeven_no_margin")}</p>
      </div>
    );
  }
  const pct = be.ca > 0 ? ca / be.ca : 1;
  const reached = ca >= be.ca;
  const remaining = Math.max(0, be.ca - ca);
  const safety = ca > 0 ? (ca - be.ca) / ca : 0;
  const markerPct = Math.min(100, (be.ca / Math.max(ca, be.ca)) * 100);
  const fillPct = Math.min(100, (ca / Math.max(ca, be.ca)) * 100);

  let status: { text: string; tone: "success" | "danger" | "accent" } | null = null;
  if (be.reachedOn) status = { text: `${t("breakeven_reached_on")} ${dayLabel(be.reachedOn)}`, tone: "success" };
  else if (be.isCurrent && be.projectedDay !== null && be.projectedDay <= be.daysInMonth)
    status = { text: `${t("breakeven_projected")} ${dayLabel(`${month}-${String(be.projectedDay).padStart(2, "0")}`)}`, tone: "accent" };
  else if (be.isCurrent) status = { text: t("breakeven_out_of_reach"), tone: "danger" };
  else if (be.isPast) status = { text: t("breakeven_not_reached"), tone: "danger" };

  return (
    <div className="card mb-5 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">⚖️ {t("breakeven")}</h2>
        {status && (
          <span className={`text-sm font-medium ${status.tone === "success" ? "text-success" : status.tone === "danger" ? "text-danger" : "text-accent"}`}>
            {status.text}
          </span>
        )}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div>
          <div className="text-xs text-muted">{t("breakeven_ca")}</div>
          <div className="text-lg font-bold text-primary">{fmtMoney(be.ca, lang)}</div>
        </div>
        <div>
          <div className="text-xs text-muted">{t("breakeven_fixed")}</div>
          <div className="text-lg font-bold">{fmtMoney(be.fixed, lang)}</div>
        </div>
        <div>
          <div className="text-xs text-muted">{t("breakeven_rate")}</div>
          <div className="text-lg font-bold">{fmtPct(be.rate, lang)}</div>
        </div>
        <div>
          <div className="text-xs text-muted">{reached ? t("breakeven_safety") : t("breakeven_remaining")}</div>
          <div className={`text-lg font-bold ${reached ? "text-success" : "text-danger"}`}>
            {reached ? fmtPct(safety, lang) : fmtMoney(remaining, lang)}
          </div>
        </div>
      </div>

      <div className="relative h-3 w-full overflow-hidden rounded-full bg-background">
        <div className="h-full rounded-full transition-all"
          style={{ width: `${fillPct}%`, background: reached ? "var(--success)" : "var(--primary)" }} />
        <div className="absolute top-0 h-full w-0.5 bg-foreground" style={{ insetInlineStart: `${markerPct}%` }} />
      </div>
      <div className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-muted">
        <span>{fmtMoney(ca, lang)} · {fmtPct(pct, lang)} {t("breakeven_of")}</span>
        {!reached && be.dailyNeeded !== null && (
          <span>{t("breakeven_daily_needed")} : <b className="text-foreground">{fmtMoney(be.dailyNeeded, lang)}</b></span>
        )}
      </div>
      <p className="mt-3 text-xs text-muted">{t("breakeven_formula")}</p>
    </div>
  );
}

function Kpi({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "primary" | "success" | "danger";
}) {
  const color =
    accent === "primary"
      ? "text-primary"
      : accent === "success"
      ? "text-success"
      : accent === "danger"
      ? "text-danger"
      : "text-foreground";
  return (
    <div className="card p-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={`mt-1 text-xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

function Progress({
  label,
  current,
  target,
  lang,
  tOf,
}: {
  label: string;
  current: number;
  target: number;
  lang: "fr" | "ar";
  tOf: string;
}) {
  const pct = target > 0 ? current / target : 0;
  const clamped = Math.min(1, Math.max(0, pct));
  const reached = pct >= 1;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className={reached ? "font-semibold text-success" : "text-muted"}>{fmtPct(pct, lang)} {tOf}</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-background">
        <div className="h-full rounded-full transition-all"
          style={{ width: `${clamped * 100}%`, background: reached ? "var(--success)" : "var(--primary)" }} />
      </div>
      <div className="mt-1 text-xs text-muted">{fmtMoney(current, lang)} / {fmtMoney(target, lang)}</div>
    </div>
  );
}

function Line({
  label,
  value,
  positive,
  muted,
}: {
  label: string;
  value: string;
  positive?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className={muted ? "text-muted" : ""}>{label}</span>
      <span className={`font-semibold ${positive ? "text-success" : ""}`}>{value}</span>
    </div>
  );
}
