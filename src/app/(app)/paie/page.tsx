"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { currentMonth, fmtMoney, fmtNum, fmtPct, monthLabel, monthRange, today } from "@/lib/format";
import { fetchAll } from "@/lib/demandData";
import { catKey, earnsCommission, rateMap } from "@/lib/commissions";
import { COMPANY } from "@/lib/company";
import { bonusFor, type BonusTier } from "@/lib/bonuses";
import { shiftMonth } from "@/lib/productInsights";
import { monthPace, monthlyCa, suggestTargets } from "@/lib/sellerTargets";
import type { CommissionRate, Seller } from "@/lib/types";

interface Prod { id: string; name: string; category: string | null; unit: string | null }
interface SaleRow { product_id: string; sale_date: string; quantity: number; sale_price: number }

const HISTORY_MONTHS = 15; // assez pour la saisonnalité M−12 (± 3 mois)
const DIR_ICON = { up: "↗", down: "↘", flat: "→" } as const;

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
  const [tiers, setTiers] = useState<BonusTier[]>([]);
  const [tiersMissing, setTiersMissing] = useState(false);
  const [history, setHistory] = useState<SaleRow[]>([]);
  const [prevBonuses, setPrevBonuses] = useState<number[]>([]);
  const [tierForm, setTierForm] = useState({ threshold: "", bonus: "" });

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
    const histStart = monthRange(shiftMonth(month, -HISTORY_MONTHS)).start;
    (async () => {
      setLoading(true);
      const [rows, tierRes, prevRes] = await Promise.all([
        fetchAll<SaleRow>((a, b) =>
          supabase.from("sales").select("product_id,sale_date,quantity,sale_price")
            .eq("seller_id", sellerId).gte("sale_date", histStart).lt("sale_date", end)
            .order("id").range(a, b)
        ),
        supabase.from("seller_bonus_tiers").select("*").eq("seller_id", sellerId).eq("month", month).order("threshold"),
        // primes des derniers paliers fixés (reprises dans la suggestion)
        supabase.from("seller_bonus_tiers").select("month,threshold,bonus").eq("seller_id", sellerId)
          .lt("month", month).order("month", { ascending: false }).limit(20),
      ]);
      if (cancelled) return;
      setHistory(rows);
      setSales(rows.filter((r) => r.sale_date >= start));
      const prev = (prevRes.data as { month: string; threshold: number; bonus: number }[]) ?? [];
      setPrevBonuses(
        prev.filter((r) => r.month === prev[0]?.month)
          .sort((a, b) => Number(a.threshold) - Number(b.threshold))
          .map((r) => Number(r.bonus))
      );
      setTiersMissing(!!tierRes.error);
      setTiers((tierRes.data as BonusTier[]) ?? []);
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
  const prime = bonusFor(totalHt, tiers);

  // Suggestion d'objectifs (mois précédents) + tendance du mois
  const caByMonth = useMemo(() => monthlyCa(history), [history]);
  const suggestion = useMemo(() => suggestTargets(caByMonth, month, prevBonuses), [caByMonth, month, prevBonuses]);
  const pace = useMemo(
    () => monthPace(sales, month, today(), suggestion?.expected ?? (caByMonth.get(shiftMonth(month, -1)) || null)),
    [sales, month, suggestion, caByMonth]
  );
  const paceTier = pace.projected !== null ? bonusFor(pace.projected, tiers) : null;

  async function applySuggestion() {
    if (!suggestion || !sellerId) return;
    if (tiers.length && !confirm(t("replace_tiers_confirm"))) return;
    await supabase.from("seller_bonus_tiers").delete().eq("seller_id", sellerId).eq("month", month);
    const { data } = await supabase.from("seller_bonus_tiers")
      .insert(suggestion.tiers.map((x) => ({ month, seller_id: sellerId, ...x })))
      .select();
    setTiers(sortTiers((data as BonusTier[]) ?? []));
  }
  const totalSalary = baseSalary + totalCommission + prime.bonus;

  const sortTiers = (list: BonusTier[]) => [...list].sort((a, b) => Number(a.threshold) - Number(b.threshold));

  async function addTier() {
    const threshold = parseFloat(tierForm.threshold) || 0;
    const bonus = parseFloat(tierForm.bonus) || 0;
    if (!sellerId || threshold <= 0) return;
    const { data, error } = await supabase.from("seller_bonus_tiers")
      .upsert({ month, seller_id: sellerId, threshold, bonus }, { onConflict: "month,seller_id,threshold" })
      .select().single();
    if (error || !data) return;
    setTiers((old) => sortTiers([...old.filter((x) => Number(x.threshold) !== threshold), data as BonusTier]));
    setTierForm({ threshold: "", bonus: "" });
  }
  async function updateTier(tier: BonusTier, field: "threshold" | "bonus", value: string) {
    const v = parseFloat(value) || 0;
    if (v === Number(tier[field]) || (field === "threshold" && v <= 0)) return;
    const { error } = await supabase.from("seller_bonus_tiers").update({ [field]: v }).eq("id", tier.id);
    if (!error) setTiers((old) => sortTiers(old.map((x) => (x.id === tier.id ? { ...x, [field]: v } : x))));
  }
  async function removeTier(id: string) {
    await supabase.from("seller_bonus_tiers").delete().eq("id", id);
    setTiers((old) => old.filter((x) => x.id !== id));
  }
  async function copyPrevMonth() {
    const [y, m] = month.split("-").map(Number);
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    const { data } = await supabase.from("seller_bonus_tiers").select("threshold,bonus")
      .eq("seller_id", sellerId).eq("month", prev);
    const rows = ((data as { threshold: number; bonus: number }[]) ?? [])
      .map((r) => ({ month, seller_id: sellerId, threshold: r.threshold, bonus: r.bonus }));
    if (!rows.length) return;
    const { data: saved } = await supabase.from("seller_bonus_tiers")
      .upsert(rows, { onConflict: "month,seller_id,threshold" }).select();
    if (saved) setTiers(sortTiers(saved as BonusTier[]));
  }

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

      {/* Objectifs / primes du mois (non imprimé) */}
      {tiersMissing ? (
        <p className="no-print mb-4 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {t("bonus_migration_missing")}
        </p>
      ) : (
        <div className="no-print card mb-4 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold">{t("bonus_tiers")}</h2>
            <button onClick={copyPrevMonth} className="rounded-lg border border-border px-3 py-1.5 text-sm">
              ⧉ {t("copy_prev_month")}
            </button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className="px-2 py-1.5 text-start font-medium">{t("threshold_ca_ht")}</th>
                  <th className="px-2 py-1.5 text-end font-medium">{t("bonus")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tiers.map((tier) => (
                  <tr key={`${tier.id}-${tier.threshold}-${tier.bonus}`}
                    className={prime.reached?.id === tier.id ? "bg-success/10 font-semibold" : ""}>
                    <td className="px-2 py-1">
                      <input type="number" defaultValue={tier.threshold} onBlur={(e) => updateTier(tier, "threshold", e.target.value)}
                        className="w-36 rounded border border-transparent bg-transparent px-1 py-1 hover:border-border focus:border-primary focus:outline-none" />
                    </td>
                    <td className="px-2 py-1 text-end">
                      <input type="number" defaultValue={tier.bonus} onBlur={(e) => updateTier(tier, "bonus", e.target.value)}
                        className="w-28 rounded border border-transparent bg-transparent px-1 py-1 text-end hover:border-border focus:border-primary focus:outline-none" />
                    </td>
                    <td className="px-2 py-1 text-center">
                      <button onClick={() => removeTier(tier.id)} className="text-danger hover:underline">✕</button>
                    </td>
                  </tr>
                ))}
                {tiers.length === 0 && (
                  <tr><td colSpan={3} className="p-3 text-center text-muted">{t("no_tiers")}</td></tr>
                )}
                <tr>
                  <td className="px-2 py-1.5">
                    <input type="number" className="input w-36" placeholder={t("threshold_ca_ht")} value={tierForm.threshold}
                      onChange={(e) => setTierForm({ ...tierForm, threshold: e.target.value })} />
                  </td>
                  <td className="px-2 py-1.5 text-end">
                    <input type="number" className="input w-28 text-end" placeholder={t("bonus")} value={tierForm.bonus}
                      onChange={(e) => setTierForm({ ...tierForm, bonus: e.target.value })} />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <button onClick={addTier} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-fg">+</button>
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted">{t("ca_ht_month")}</span>
                <span className="font-bold">{fmtMoney(totalHt, lang)}</span></div>
              <div className="flex justify-between"><span className="text-muted">{t("tier_reached")}</span>
                <span className="font-semibold">
                  {prime.reached ? `${fmtMoney(Number(prime.reached.threshold), lang)} → ${fmtMoney(prime.bonus, lang)}` : t("no_tier_reached")}
                </span></div>
              {prime.next && (
                <>
                  <div className="flex justify-between"><span className="text-muted">{t("next_tier")}</span>
                    <span>{fmtMoney(Number(prime.next.threshold), lang)} → {fmtMoney(Number(prime.next.bonus), lang)}
                      <span className="ms-1 text-muted">({t("remaining")} {fmtMoney(Number(prime.next.threshold) - totalHt, lang)})</span></span></div>
                  <div className="h-2 overflow-hidden rounded-full bg-border">
                    <div className="h-full bg-primary" style={{ width: `${Math.min(100, (totalHt / Number(prime.next.threshold)) * 100)}%` }} />
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Suggestion + tendance */}
          <div className="mt-4 grid gap-4 border-t border-border pt-4 md:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-semibold">💡 {t("suggested_targets")}</h3>
              {suggestion ? (
                <>
                  <div className="mb-2 flex justify-between text-sm">
                    <span className="text-muted">{t("expected_ca")}</span>
                    <span className="font-bold">{fmtMoney(suggestion.expected, lang)}</span>
                  </div>
                  <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                      {t("recent_level")} {fmtMoney(suggestion.level, lang)}
                    </span>
                    {suggestion.trendPct !== null && (
                      <span className={`rounded-full px-2 py-0.5 ${suggestion.trendPct >= 0 ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>
                        {t("trend")} {suggestion.trendPct >= 0 ? "+" : ""}{fmtPct(suggestion.trendPct, lang)} / {t("per_month")}
                      </span>
                    )}
                    {suggestion.seasonal !== null && (
                      <span className="rounded-full bg-accent/15 px-2 py-0.5 text-accent">
                        {t("seasonality")} ×{fmtNum(suggestion.seasonal, lang)}
                      </span>
                    )}
                  </div>
                  <table className="mb-3 w-full text-sm">
                    <tbody className="divide-y divide-border">
                      {suggestion.tiers.map((x, i) => (
                        <tr key={i}>
                          <td className="py-1 text-muted">{t("tier")} {i + 1}</td>
                          <td className="py-1 text-end">{fmtMoney(x.threshold, lang)}</td>
                          <td className="py-1 text-end font-semibold">→ {fmtMoney(x.bonus, lang)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button onClick={applySuggestion} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-fg">
                    {t("apply_suggestion")}
                  </button>
                  <p className="mt-2 text-xs text-muted">{t("suggestion_method")}</p>
                </>
              ) : (
                <p className="text-sm text-muted">{t("no_seller_history")}</p>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold">📊 {pace.complete ? t("month_result") : t("month_trend")}</h3>
              {pace.direction && pace.projected !== null ? (
                <div className={`mb-3 flex items-center gap-3 rounded-lg p-3 ${
                  pace.direction === "up" ? "bg-success/10 text-success" : pace.direction === "down" ? "bg-danger/10 text-danger" : "bg-border/40"
                }`}>
                  <span className="text-3xl leading-none">{DIR_ICON[pace.direction]}</span>
                  <div>
                    <div className="font-bold">
                      {t(`dir_${pace.direction}`)} {pace.deltaPct !== null && `(${pace.deltaPct >= 0 ? "+" : ""}${fmtPct(pace.deltaPct, lang)})`}
                    </div>
                    <div className="text-xs opacity-80">
                      {suggestion ? t("vs_expected") : t("vs_prev_month")}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="mb-3 text-sm text-muted">{t("no_data")}</p>
              )}
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted">
                    {t("ca_ht_month")}{pace.lastDate && !pace.complete ? ` (${t("until")} ${pace.lastDate.slice(8, 10)}/${pace.lastDate.slice(5, 7)})` : ""}
                  </span>
                  <span>{fmtMoney(pace.actual, lang)}</span>
                </div>
                {!pace.complete && pace.projected !== null && (
                  <div className="flex justify-between">
                    <span className="text-muted">{t("projected_eom")}</span>
                    <span className="font-bold">{fmtMoney(pace.projected, lang)}</span>
                  </div>
                )}
                {!pace.complete && paceTier && tiers.length > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted">{t("tier_at_pace")}</span>
                    <span className="font-semibold">
                      {paceTier.reached ? `${fmtMoney(Number(paceTier.reached.threshold), lang)} → ${fmtMoney(paceTier.bonus, lang)}` : t("no_tier_reached")}
                    </span>
                  </div>
                )}
              </div>
              {/* Historique : mois de référence + mois affiché */}
              {suggestion && (
                <div className="mt-3 space-y-1">
                  {[...suggestion.basis, { month, ca: pace.projected ?? pace.actual }].map((b) => {
                    const max = Math.max(...suggestion.basis.map((x) => x.ca), pace.projected ?? 0, suggestion.expected);
                    const isCur = b.month === month;
                    return (
                      <div key={b.month} className="flex items-center gap-2 text-xs">
                        <span className="w-16 shrink-0 capitalize text-muted">{monthLabel(b.month, lang).slice(0, 3)} {b.month.slice(2, 4)}</span>
                        <div className="h-3 flex-1 overflow-hidden rounded bg-border/40">
                          <div className={`h-full ${isCur ? "bg-accent" : "bg-primary/60"}`} style={{ width: `${max ? (b.ca / max) * 100 : 0}%` }} />
                        </div>
                        <span className="w-24 shrink-0 text-end">{fmtMoney(b.ca, lang)}{isCur && !pace.complete ? "*" : ""}</span>
                      </div>
                    );
                  })}
                  {!pace.complete && <p className="text-[11px] text-muted">* {t("projected_eom")}</p>}
                </div>
              )}
            </div>
          </div>
        </div>
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
          <div className="flex justify-between border-t border-border px-4 py-2 text-sm">
            <span>
              {t("bonus_ca")}
              {prime.reached && (
                <span className="ms-1 text-xs text-muted">
                  ({t("ca_ht_month")} ≥ {fmtMoney(Number(prime.reached.threshold), lang)})
                </span>
              )}
            </span>
            <span>{fmtMoney(prime.bonus, lang)}</span>
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
