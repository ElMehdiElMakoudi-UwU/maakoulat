"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import Link from "next/link";
import { currentMonth, fmtMoney, monthLabel, today } from "@/lib/format";
import { fetchAll } from "@/lib/demandData";
import { reconcileTx, unreconcileTx } from "@/lib/bankReconcile";
import TvaYearView from "@/components/TvaYearView";
import type { BankTransaction, Supplier } from "@/lib/types";
import {
  byRate, periodKey, periodMonths, periodRange, previousPeriod, round2, vatFromTTC,
  type PeriodMode,
} from "@/lib/tva";

interface SaleRow { product_id: string; quantity: number; sale_price: number }
interface InvItem { quantity: number; unit_price: number; vat_rate: number }
interface Declaration {
  period: string; collected: number; deductible: number; credit_in: number; result: number;
  declared_on: string; paid_on: string | null; note: string | null;
}

export default function TvaPage() {
  const { t, lang } = useI18n();
  const supabase = useMemo(() => createClient(), []);
  const [view, setView] = useState<"period" | "year">("period");
  const [mode, setMode] = useState<PeriodMode>("month");
  const [month, setMonth] = useState(currentMonth());
  const period = periodKey(month, mode);
  const months = useMemo(() => periodMonths(period), [period]);

  const [loading, setLoading] = useState(true);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [vatOf, setVatOf] = useState<Record<string, number>>({});
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [invItems, setInvItems] = useState<InvItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [debits, setDebits] = useState<BankTransaction[]>([]);
  const [onlyAssigned, setOnlyAssigned] = useState(false);
  const [busyTx, setBusyTx] = useState<string | null>(null);
  const [decl, setDecl] = useState<Declaration | null>(null);
  const [prevDecl, setPrevDecl] = useState<Declaration | null>(null);
  const [creditIn, setCreditIn] = useState("0");

  const load = useCallback(async () => {
    setLoading(true);
    const { start, end } = periodRange(period);
    const [prodRows, saleRows, invRes, supRes, txRes, declRes] = await Promise.all([
      fetchAll<{ id: string; vat_rate: number }>((a, b) =>
        supabase.from("products").select("id,vat_rate").order("id").range(a, b)),
      fetchAll<SaleRow>((a, b) =>
        supabase.from("sales").select("product_id,quantity,sale_price")
          .gte("sale_date", start).lt("sale_date", end).order("id").range(a, b)),
      supabase.from("sales_invoices").select("id").eq("status", "final").in("month", months),
      supabase.from("suppliers").select("*").order("sort_order"),
      supabase.from("bank_transactions").select("*").eq("direction", "debit")
        .gte("op_date", start).lt("op_date", end).order("op_date"),
      supabase.from("tva_declarations").select("*").in("period", [period, previousPeriod(period)]),
    ]);

    const sups = (supRes.data as Supplier[]) ?? [];
    setMigrationMissing(!!declRes.error || (sups.length > 0 && !("vat_rate" in sups[0])));
    setVatOf(Object.fromEntries(prodRows.map((p) => [p.id, Number(p.vat_rate) || 0])));
    setSales(saleRows);
    setSuppliers(sups);
    setDebits((txRes.data as BankTransaction[]) ?? []);

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

  // TVA déductible : débits du relevé rapprochés avec un fournisseur, au taux du fournisseur
  const supById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);
  const debitRows = useMemo(
    () => debits.map((x) => {
      const sup = x.supplier_id ? supById.get(x.supplier_id) : undefined;
      const paid = Math.abs(Number(x.amount));
      return { tx: x, sup, paid, rate: sup?.vat_rate ?? null, vat: sup ? vatFromTTC(paid, sup.vat_rate) : 0 };
    }),
    [debits, supById]
  );
  const assigned = debitRows.filter((r) => r.sup);
  const deductible = assigned.reduce((s, r) => s + r.vat, 0);
  const paidToSuppliers = assigned.reduce((s, r) => s + r.paid, 0);
  const unassignedCount = debitRows.length - assigned.length;
  const visibleDebits = onlyAssigned ? assigned : debitRows;
  // Fournisseurs payés sur la période mais sans taux de TVA renseigné
  const suppliersMissingRate = [...new Map(
    assigned.filter((r) => r.sup!.vat_rate == null).map((r) => [r.sup!.id, r.sup!])
  ).values()];
  const credit = Math.max(0, parseFloat(creditIn) || 0);
  const result = round2(collected - deductible - credit);

  const changedSinceDecl = !!decl && (
    Math.abs(Number(decl.collected) - round2(collected)) > 0.01 ||
    Math.abs(Number(decl.deductible) - round2(deductible)) > 0.01
  );

  // ---------- Actions ----------
  // Choisir un fournisseur = rapprocher le débit (même logique que la page Banque)
  async function assignSupplier(tx: BankTransaction, supplierId: string) {
    if (supplierId === (tx.supplier_id ?? "")) return;
    setBusyTx(tx.id);
    let cur = tx;
    if (tx.reconciled || tx.supplier_id) {
      const patch = await unreconcileTx(supabase, tx);
      cur = { ...tx, ...patch };
    }
    if (supplierId) {
      const patch = await reconcileTx(supabase, cur, supplierId);
      if (patch) cur = { ...cur, ...patch };
    }
    setDebits((old) => old.map((x) => (x.id === tx.id ? cur : x)));
    setBusyTx(null);
  }
  async function declare() {
    if ((suppliersMissingRate.length > 0 || unassignedCount > 0) && !confirm(t("tva_confirm_missing"))) return;
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
      ["TVA déductible — paiements fournisseurs (relevé bancaire)", "Date", "Libellé", "Fournisseur", "Montant payé TTC", "Taux", "TVA"],
      ...assigned.map((r) => ["", r.tx.op_date, r.tx.label, r.sup!.name, r.paid.toFixed(2),
        r.rate == null ? "?" : `${r.rate}%`, r.vat.toFixed(2)]),
      ["", "", "", "Total", paidToSuppliers.toFixed(2), "", deductible.toFixed(2)],
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

  // Depuis la vue annuelle : ouvrir une période (premier mois de la période)
  function openPeriod(key: string) {
    setMonth(periodMonths(key)[0]);
    setView("period");
  }

  return (
    <div>
      <div className="no-print mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("tva_title")}</h1>
          <p className="text-sm text-muted">{t("tva_hint")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border bg-surface p-0.5 text-sm">
            {(["period", "year"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`rounded-md px-3 py-1.5 font-medium ${view === v ? "bg-primary text-primary-fg" : "text-muted hover:text-foreground"}`}>
                {t(v === "period" ? "tva_view_period" : "tva_view_year")}
              </button>
            ))}
          </div>
          <select value={mode} onChange={(e) => setMode(e.target.value as PeriodMode)}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary">
            <option value="month">{t("tva_monthly")}</option>
            <option value="quarter">{t("tva_quarterly")}</option>
          </select>
          {view === "period" && (<>
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-2 outline-none focus:border-primary" />
          <button onClick={exportCsv} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium hover:bg-background">
            ⬇️ {t("export_csv")}
          </button>
          <button onClick={() => window.print()} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg">
            🖨️ {t("print_pdf")}
          </button>
          </>)}
        </div>
      </div>

      {migrationMissing && (
        <p className="no-print mb-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{t("tva_migration_missing")}</p>
      )}

      {view === "year" ? (
        <TvaYearView mode={mode} onOpen={openPeriod} />
      ) : loading ? (
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
            {suppliersMissingRate.length > 0 && (
              <p className="no-print mt-3 rounded-lg bg-accent/10 px-3 py-2 text-xs text-accent">
                ⚠️ {t("tva_missing_rates")} <span className="font-semibold">{suppliersMissingRate.map((s) => s.name).join(", ")}</span>
                {" — "}<Link href="/fournisseurs" className="underline">{t("nav_suppliers")}</Link>
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

          {/* TVA déductible — débits du relevé bancaire */}
          <div className="card overflow-x-auto">
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-2.5">
              <div>
                <div className="font-bold">{t("tva_deductible")} — {t("tva_bank_payments")}</div>
                <div className="no-print text-xs text-muted">{t("tva_deductible_hint")}</div>
              </div>
              {debitRows.length > 0 && (
                <div className="no-print flex items-center gap-3 text-xs">
                  {unassignedCount > 0 && (
                    <span className="rounded-full bg-accent/15 px-2 py-0.5 font-medium text-accent">
                      {unassignedCount} {t("tva_unassigned")}
                    </span>
                  )}
                  <label className="flex items-center gap-1.5 text-muted">
                    <input type="checkbox" checked={onlyAssigned} onChange={(e) => setOnlyAssigned(e.target.checked)} />
                    {t("tva_only_assigned")}
                  </label>
                </div>
              )}
            </div>
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className="px-4 py-2 text-start font-medium">{t("date")}</th>
                  <th className="px-4 py-2 text-start font-medium">{t("label")}</th>
                  <th className="px-4 py-2 text-end font-medium">{t("tva_paid_amount")}</th>
                  <th className="px-4 py-2 text-start font-medium">{t("supplier")}</th>
                  <th className="px-4 py-2 text-end font-medium">{t("vat")}</th>
                  <th className="px-4 py-2 text-end font-medium">{t("vat_amount")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleDebits.map((r) => (
                  <tr key={r.tx.id} className={r.sup ? "bg-success/5" : "print:hidden"}>
                    <td className="whitespace-nowrap px-4 py-2">{fmtD(r.tx.op_date)}</td>
                    <td className="px-4 py-2">
                      <div>{r.tx.label}</div>
                      {r.tx.op_ref && <div className="text-xs text-muted">{r.tx.op_ref}</div>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-end font-medium">{fmtMoney(r.paid, lang)}</td>
                    <td className="px-4 py-2">
                      <select
                        value={r.tx.supplier_id ?? ""}
                        disabled={busyTx === r.tx.id}
                        onChange={(e) => assignSupplier(r.tx, e.target.value)}
                        className="no-print input max-w-[12rem] py-1 text-sm disabled:opacity-50"
                      >
                        <option value="">—</option>
                        {suppliers
                          .filter((s) => s.active || s.id === r.tx.supplier_id)
                          .map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                      <span className="print-area hidden">{r.sup?.name ?? ""}</span>
                    </td>
                    <td className={`px-4 py-2 text-end ${r.sup && r.rate == null ? "font-semibold text-accent" : ""}`}>
                      {r.sup ? (r.rate == null ? "?" : `${Number(r.rate)}%`) : "—"}
                    </td>
                    <td className="px-4 py-2 text-end font-semibold">{r.sup ? fmtMoney(r.vat, lang) : "—"}</td>
                  </tr>
                ))}
                {visibleDebits.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-muted">
                      {debits.length ? t("no_data") : <>{t("tva_no_bank")} — <Link href="/banque" className="text-primary underline">{t("nav_bank")}</Link></>}
                    </td>
                  </tr>
                )}
              </tbody>
              {assigned.length > 0 && (
                <tfoot>
                  <tr className="border-t border-border font-bold">
                    <td className="px-4 py-2.5" colSpan={2}>{t("total")}</td>
                    <td className="px-4 py-2.5 text-end">{fmtMoney(paidToSuppliers, lang)}</td>
                    <td colSpan={2} />
                    <td className="px-4 py-2.5 text-end">{fmtMoney(deductible, lang)}</td>
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
