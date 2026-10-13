"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { currentMonth, fmtMoney, monthLabel, today } from "@/lib/format";
import { fetchAll } from "@/lib/demandData";
import {
  VAT_RATES, byRate, periodKey, periodMonths, periodRange, previousPeriod, round2, vatFromTTC,
  type PeriodMode,
} from "@/lib/tva";

interface SaleRow { product_id: string; quantity: number; sale_price: number }
interface SupInv { id: string; inv_date: string; amount: number; vat_rate: number | null; note: string | null; suppliers: { name: string } | { name: string }[] | null }
interface ChargeRow { id: string; label: string; amount: number; month: string | null; active: boolean; vat_rate: number | null }
interface InvItem { quantity: number; unit_price: number; vat_rate: number }
interface Declaration {
  period: string; collected: number; deductible: number; credit_in: number; result: number;
  declared_on: string; paid_on: string | null; note: string | null;
}

const supName = (r: SupInv) => (Array.isArray(r.suppliers) ? r.suppliers[0]?.name : r.suppliers?.name) ?? "—";

export default function TvaPage() {
  const { t, lang } = useI18n();
  const supabase = useMemo(() => createClient(), []);
  const [mode, setMode] = useState<PeriodMode>("month");
  const [month, setMonth] = useState(currentMonth());
  const period = periodKey(month, mode);
  const months = useMemo(() => periodMonths(period), [period]);

  const [loading, setLoading] = useState(true);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [vatOf, setVatOf] = useState<Record<string, number>>({});
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [invItems, setInvItems] = useState<InvItem[]>([]);
  const [supInvoices, setSupInvoices] = useState<SupInv[]>([]);
  const [charges, setCharges] = useState<ChargeRow[]>([]);
  const [decl, setDecl] = useState<Declaration | null>(null);
  const [prevDecl, setPrevDecl] = useState<Declaration | null>(null);
  const [creditIn, setCreditIn] = useState("0");

  const load = useCallback(async () => {
    setLoading(true);
    const { start, end } = periodRange(period);
    const [prodRows, saleRows, invRes, supRes, chRes, declRes] = await Promise.all([
      fetchAll<{ id: string; vat_rate: number }>((a, b) =>
        supabase.from("products").select("id,vat_rate").order("id").range(a, b)),
      fetchAll<SaleRow>((a, b) =>
        supabase.from("sales").select("product_id,quantity,sale_price")
          .gte("sale_date", start).lt("sale_date", end).order("id").range(a, b)),
      supabase.from("sales_invoices").select("id").eq("status", "final").in("month", months),
      supabase.from("supplier_invoices").select("id,inv_date,amount,vat_rate,note,suppliers(name)")
        .gte("inv_date", start).lt("inv_date", end).order("inv_date"),
      supabase.from("charges").select("id,label,amount,month,active,vat_rate")
        .or(`month.is.null,month.in.(${months.join(",")})`).order("sort_order"),
      supabase.from("tva_declarations").select("*").in("period", [period, previousPeriod(period)]),
    ]);

    setMigrationMissing(!!supRes.error || !!chRes.error || !!declRes.error);
    setVatOf(Object.fromEntries(prodRows.map((p) => [p.id, Number(p.vat_rate) || 0])));
    setSales(saleRows);
    setSupInvoices((supRes.data as SupInv[]) ?? []);
    setCharges(((chRes.data as ChargeRow[]) ?? []).filter((c) => c.month || c.active));

    const invIds = ((invRes.data as { id: string }[]) ?? []).map((r) => r.id);
    if (invIds.length) {
      const { data } = await supabase.from("sales_invoice_items").select("quantity,unit_price,vat_rate").in("invoice_id", invIds);
      setInvItems((data as InvItem[]) ?? []);
    } else setInvItems([]);

    const decls = (declRes.data as Declaration[]) ?? [];
    const cur = decls.find((d) => d.period === period) ?? null;
    const prev = decls.find((d) => d.period === previousPeriod(period)) ?? null;
    setDecl(cur);
    setPrevDecl(prev);
    // Crédit reporté : figé si la période est déjà déclarée, sinon crédit de la période précédente
    const autoCredit = prev && Number(prev.result) < 0 ? -Number(prev.result) : 0;
    setCreditIn(String(round2(cur ? Number(cur.credit_in) : autoCredit)));
    setLoading(false);
  }, [supabase, period, months]);

  useEffect(() => { load(); }, [load]);

  // ---------- Calculs ----------
  const collectedLines = useMemo(
    () => byRate(sales.map((s) => ({ ht: Number(s.quantity) * Number(s.sale_price), rate: vatOf[s.product_id] ?? 0 }))),
    [sales, vatOf]
  );
  const collected = collectedLines.reduce((s, l) => s + l.vat, 0);
  const invoicedVat = invItems.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price) * Number(i.vat_rate) / 100, 0);

  // Charges fixes : comptées une fois par mois de la période
  const chargeRows = useMemo(
    () => charges.map((c) => {
      const ttcAmt = Number(c.amount) * (c.month ? 1 : months.length);
      return { ...c, ttc: ttcAmt, vat: vatFromTTC(ttcAmt, c.vat_rate) };
    }),
    [charges, months]
  );
  const supVat = supInvoices.reduce((s, i) => s + vatFromTTC(Number(i.amount), i.vat_rate), 0);
  const chargeVat = chargeRows.reduce((s, c) => s + c.vat, 0);
  const deductible = supVat + chargeVat;
  const credit = Math.max(0, parseFloat(creditIn) || 0);
  const result = round2(collected - deductible - credit);
  const missingSup = supInvoices.filter((i) => i.vat_rate == null).length;

  const changedSinceDecl = !!decl && (
    Math.abs(Number(decl.collected) - round2(collected)) > 0.01 ||
    Math.abs(Number(decl.deductible) - round2(deductible)) > 0.01
  );

  // ---------- Actions ----------
  async function setSupRate(id: string, v: string) {
    const rate = v === "" ? null : Number(v);
    setSupInvoices((old) => old.map((i) => (i.id === id ? { ...i, vat_rate: rate } : i)));
    await supabase.from("supplier_invoices").update({ vat_rate: rate }).eq("id", id);
  }
  async function setChargeRate(id: string, v: string) {
    const rate = v === "" ? null : Number(v);
    setCharges((old) => old.map((c) => (c.id === id ? { ...c, vat_rate: rate } : c)));
    await supabase.from("charges").update({ vat_rate: rate }).eq("id", id);
  }
  async function declare() {
    if (missingSup > 0 && !confirm(t("tva_confirm_missing"))) return;
    await supabase.from("tva_declarations").upsert({
      period,
      collected: round2(collected),
      deductible: round2(deductible),
      credit_in: round2(credit),
      result,
      declared_on: decl?.declared_on ?? today(),
      paid_on: decl?.paid_on ?? null,
    });
    await load();
  }
  async function markPaid(paid: boolean) {
    await supabase.from("tva_declarations").update({ paid_on: paid ? today() : null }).eq("period", period);
    await load();
  }
  async function undeclare() {
    if (!confirm(t("tva_confirm_undeclare"))) return;
    await supabase.from("tva_declarations").delete().eq("period", period);
    await load();
  }

  function exportCsv() {
    const sep = ";";
    const q = (c: unknown) => `"${String(c).replace(/"/g, '""')}"`;
    const rows: unknown[][] = [
      ["Période", periodTitle],
      [],
      ["TVA collectée", "Taux", "Base HT", "TVA", "TTC"],
      ...collectedLines.map((l) => ["", `${l.rate}%`, l.base.toFixed(2), l.vat.toFixed(2), (l.base + l.vat).toFixed(2)]),
      ["", "Total", "", collected.toFixed(2), ""],
      [],
      ["TVA déductible — factures fournisseurs", "Date", "Fournisseur", "TTC", "Taux", "TVA"],
      ...supInvoices.map((i) => ["", i.inv_date, supName(i), Number(i.amount).toFixed(2),
        i.vat_rate == null ? "?" : `${i.vat_rate}%`, vatFromTTC(Number(i.amount), i.vat_rate).toFixed(2)]),
      ["TVA déductible — charges", "", "Libellé", "TTC", "Taux", "TVA"],
      ...chargeRows.map((c) => ["", "", c.label, c.ttc.toFixed(2), c.vat_rate == null ? "" : `${c.vat_rate}%`, c.vat.toFixed(2)]),
      ["", "", "Total déductible", "", "", deductible.toFixed(2)],
      [],
      ["Crédit reporté", credit.toFixed(2)],
      [result >= 0 ? "TVA à payer" : "Crédit de TVA", Math.abs(result).toFixed(2)],
    ];
    const csv = "﻿" + rows.map((r) => r.map(q).join(sep)).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `tva-${period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const periodTitle = mode === "month"
    ? monthLabel(month, lang)
    : `${t("tva_quarter")} ${period.slice(-1)} ${period.slice(0, 4)}`;
  const fmtD = (d: string) =>
    new Intl.DateTimeFormat(lang === "ar" ? "ar-MA" : "fr-FR", { dateStyle: "medium" }).format(new Date(d + "T00:00:00"));

  const rateSelect = (value: number | null | undefined, onChange: (v: string) => void, allowNone: string) => (
    <select value={value == null ? "" : String(Number(value))} onChange={(e) => onChange(e.target.value)}
      className={`no-print rounded-md border bg-surface px-2 py-1 text-sm outline-none focus:border-primary ${value == null && allowNone === "?" ? "border-accent" : "border-border"}`}>
      <option value="">{allowNone}</option>
      {VAT_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
    </select>
  );

  return (
    <div>
      <div className="no-print mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("tva_title")}</h1>
          <p className="text-sm text-muted">{t("tva_hint")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={mode} onChange={(e) => setMode(e.target.value as PeriodMode)}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary">
            <option value="month">{t("tva_monthly")}</option>
            <option value="quarter">{t("tva_quarterly")}</option>
          </select>
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-2 outline-none focus:border-primary" />
          <button onClick={exportCsv} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium hover:bg-background">
            ⬇️ {t("export_csv")}
          </button>
          <button onClick={() => window.print()} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg">
            🖨️ {t("print_pdf")}
          </button>
        </div>
      </div>

      {migrationMissing && (
        <p className="no-print mb-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{t("tva_migration_missing")}</p>
      )}

      {loading ? (
        <p className="p-8 text-center text-muted">{t("loading")}</p>
      ) : (
        <div className="print-area space-y-5">
          {/* Synthèse */}
          <div className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-xl font-bold">{t("tva_title")}</h2>
                <p className="text-sm text-muted">{t("period")} : <span className="capitalize">{periodTitle}</span></p>
              </div>
              <div className="text-end text-xs">
                {decl ? (
                  <div className="space-y-0.5">
                    <div className="font-semibold text-success">✓ {t("tva_declared_on")} {fmtD(decl.declared_on)}</div>
                    {decl.paid_on
                      ? <div className="text-success">✓ {t("tva_paid_on")} {fmtD(decl.paid_on)}</div>
                      : Number(decl.result) > 0 && <div className="text-accent">{t("tva_not_paid")}</div>}
                  </div>
                ) : (
                  <span className="rounded-full bg-accent/15 px-2 py-0.5 font-medium text-accent">{t("tva_not_declared")}</span>
                )}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label={t("tva_collected")} value={fmtMoney(collected, lang)} />
              <Stat label={t("tva_deductible")} value={`− ${fmtMoney(deductible, lang)}`} />
              <div className="rounded-lg border border-border bg-background p-3">
                <div className="text-xs font-medium text-muted">{t("tva_credit_in")}</div>
                <div className="mt-0.5 flex items-center gap-1 text-lg font-bold">
                  <span>−</span>
                  <input type="number" min={0} step="0.01" value={creditIn} disabled={!!decl}
                    onChange={(e) => setCreditIn(e.target.value)}
                    className="no-print w-full rounded-md border border-border bg-surface px-2 py-0.5 text-base outline-none focus:border-primary disabled:opacity-70" />
                  <span className="print-area hidden">{fmtMoney(credit, lang)}</span>
                </div>
                {!decl && prevDecl && Number(prevDecl.result) < 0 && (
                  <div className="no-print mt-0.5 text-[11px] text-muted">{t("tva_credit_auto")}</div>
                )}
              </div>
              <Stat
                label={result >= 0 ? t("tva_to_pay") : t("tva_credit_out")}
                value={fmtMoney(Math.abs(result), lang)}
                color={result > 0 ? "text-danger" : "text-success"}
              />
            </div>

            {changedSinceDecl && (
              <p className="no-print mt-3 rounded-lg bg-accent/10 px-3 py-2 text-xs text-accent">
                {t("tva_changed_since")} ({t("tva_declared_amounts")} : {fmtMoney(Number(decl!.collected), lang)} / {fmtMoney(Number(decl!.deductible), lang)})
              </p>
            )}
            {missingSup > 0 && (
              <p className="no-print mt-3 rounded-lg bg-accent/10 px-3 py-2 text-xs text-accent">
                ⚠️ {missingSup} {t("tva_missing_rates")}
              </p>
            )}

            <div className="no-print mt-4 flex flex-wrap gap-2">
              {!decl || changedSinceDecl ? (
                <button onClick={declare} disabled={migrationMissing}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg disabled:opacity-50">
                  {decl ? `↻ ${t("tva_update_decl")}` : `✓ ${t("tva_mark_declared")}`}
                </button>
              ) : null}
              {decl && Number(decl.result) > 0 && (
                <button onClick={() => markPaid(!decl.paid_on)}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium hover:bg-background">
                  {decl.paid_on ? t("tva_unmark_paid") : `💳 ${t("tva_mark_paid")}`}
                </button>
              )}
              {decl && (
                <button onClick={undeclare} className="rounded-lg px-3 py-2 text-sm text-danger hover:bg-danger/10">
                  {t("tva_undeclare")}
                </button>
              )}
            </div>
          </div>

          {/* TVA collectée */}
          <div className="card overflow-x-auto">
            <div className="border-b border-border px-4 py-2.5">
              <div className="font-bold">{t("tva_collected")}</div>
              <div className="text-xs text-muted">{t("tva_collected_hint")}</div>
            </div>
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className="px-4 py-2 text-start font-medium">{t("vat")}</th>
                  <th className="px-4 py-2 text-end font-medium">{t("tva_base_ht")}</th>
                  <th className="px-4 py-2 text-end font-medium">{t("vat_amount")}</th>
                  <th className="px-4 py-2 text-end font-medium">TTC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {collectedLines.map((l) => (
                  <tr key={l.rate}>
                    <td className="px-4 py-2.5 font-medium">{l.rate}%</td>
                    <td className="px-4 py-2.5 text-end">{fmtMoney(l.base, lang)}</td>
                    <td className="px-4 py-2.5 text-end font-semibold">{fmtMoney(l.vat, lang)}</td>
                    <td className="px-4 py-2.5 text-end">{fmtMoney(l.base + l.vat, lang)}</td>
                  </tr>
                ))}
                {collectedLines.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-muted">{t("no_data")}</td></tr>}
              </tbody>
              {collectedLines.length > 0 && (
                <tfoot>
                  <tr className="border-t border-border font-bold">
                    <td className="px-4 py-2.5">{t("total")}</td>
                    <td className="px-4 py-2.5 text-end">{fmtMoney(collectedLines.reduce((s, l) => s + l.base, 0), lang)}</td>
                    <td className="px-4 py-2.5 text-end">{fmtMoney(collected, lang)}</td>
                    <td className="px-4 py-2.5 text-end">{fmtMoney(collectedLines.reduce((s, l) => s + l.base + l.vat, 0), lang)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
            <div className="border-t border-border px-4 py-2.5 text-xs text-muted">
              {t("tva_invoiced_check")} : <span className="font-semibold text-foreground">{fmtMoney(invoicedVat, lang)}</span>
              {" "}({t("tva_invoiced_check_hint")})
            </div>
          </div>

          {/* TVA déductible — factures fournisseurs */}
          <div className="card overflow-x-auto">
            <div className="border-b border-border px-4 py-2.5">
              <div className="font-bold">{t("tva_deductible")} — {t("tva_supplier_invoices")}</div>
              <div className="no-print text-xs text-muted">{t("tva_deductible_hint")}</div>
            </div>
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className="px-4 py-2 text-start font-medium">{t("date")}</th>
                  <th className="px-4 py-2 text-start font-medium">{t("supplier")}</th>
                  <th className="px-4 py-2 text-end font-medium">TTC</th>
                  <th className="px-4 py-2 text-end font-medium">{t("vat")}</th>
                  <th className="px-4 py-2 text-end font-medium">{t("vat_amount")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {supInvoices.map((i) => (
                  <tr key={i.id}>
                    <td className="px-4 py-2 whitespace-nowrap">{fmtD(i.inv_date)}</td>
                    <td className="px-4 py-2 font-medium">
                      {supName(i)}
                      {i.note && <span className="ms-1 text-xs text-muted">· {i.note}</span>}
                    </td>
                    <td className="px-4 py-2 text-end">{fmtMoney(Number(i.amount), lang)}</td>
                    <td className="px-4 py-2 text-end">
                      {rateSelect(i.vat_rate, (v) => setSupRate(i.id, v), "?")}
                      <span className="print-area hidden">{i.vat_rate == null ? "?" : `${i.vat_rate}%`}</span>
                    </td>
                    <td className="px-4 py-2 text-end font-semibold">{fmtMoney(vatFromTTC(Number(i.amount), i.vat_rate), lang)}</td>
                  </tr>
                ))}
                {supInvoices.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted">{t("no_data")}</td></tr>}
              </tbody>
              {supInvoices.length > 0 && (
                <tfoot>
                  <tr className="border-t border-border font-bold">
                    <td className="px-4 py-2.5" colSpan={4}>{t("total")}</td>
                    <td className="px-4 py-2.5 text-end">{fmtMoney(supVat, lang)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* TVA déductible — charges */}
          <div className="card overflow-x-auto">
            <div className="border-b border-border px-4 py-2.5">
              <div className="font-bold">{t("tva_deductible")} — {t("nav_charges")}</div>
              <div className="no-print text-xs text-muted">{t("tva_charges_hint")}</div>
            </div>
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className="px-4 py-2 text-start font-medium">{t("label")}</th>
                  <th className="px-4 py-2 text-end font-medium">TTC</th>
                  <th className="px-4 py-2 text-end font-medium">{t("vat")}</th>
                  <th className="px-4 py-2 text-end font-medium">{t("vat_amount")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {chargeRows.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-2 font-medium">
                      {c.label}
                      <span className="ms-1 text-xs text-muted">· {c.month ? t("one_off_short") : t("recurring_short")}</span>
                    </td>
                    <td className="px-4 py-2 text-end">{fmtMoney(c.ttc, lang)}</td>
                    <td className="px-4 py-2 text-end">
                      {rateSelect(c.vat_rate, (v) => setChargeRate(c.id, v), t("tva_no_vat"))}
                      <span className="print-area hidden">{c.vat_rate == null ? "—" : `${c.vat_rate}%`}</span>
                    </td>
                    <td className="px-4 py-2 text-end font-semibold">{fmtMoney(c.vat, lang)}</td>
                  </tr>
                ))}
                {chargeRows.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-muted">{t("no_data")}</td></tr>}
              </tbody>
              {chargeRows.length > 0 && (
                <tfoot>
                  <tr className="border-t border-border font-bold">
                    <td className="px-4 py-2.5" colSpan={3}>{t("total")}</td>
                    <td className="px-4 py-2.5 text-end">{fmtMoney(chargeVat, lang)}</td>
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

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={`mt-0.5 text-lg font-bold ${color ?? "text-foreground"}`}>{value}</div>
    </div>
  );
}
