"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { currentMonth, fmtMoney, monthLabel } from "@/lib/format";
import { fetchAll } from "@/lib/demandData";
import { periodKey, periodMonths, round2, vatFromTTC, type PeriodMode } from "@/lib/tva";

interface SaleRow { product_id: string; quantity: number; sale_price: number; sale_date: string }
interface DebitRow { op_date: string; amount: number; supplier_id: string }
interface Declaration {
  period: string; collected: number; deductible: number; credit_in: number; result: number;
  declared_on: string; paid_on: string | null;
}
type Status = "paid" | "declared_unpaid" | "declared" | "todo" | "future";

interface Row {
  key: string;
  collected: number;
  deductible: number;
  creditIn: number;
  result: number;
  decl: Declaration | null;
  status: Status;
}

// Vue annuelle : une ligne par mois / trimestre. Période déclarée = montants figés ;
// sinon estimation à partir des ventes et des débits bancaires rapprochés.
export default function TvaYearView({ mode, onOpen }: { mode: PeriodMode; onOpen: (period: string) => void }) {
  const { t, lang } = useI18n();
  const supabase = useMemo(() => createClient(), []);
  const [year, setYear] = useState(Number(currentMonth().slice(0, 4)));
  const [loading, setLoading] = useState(true);
  const [collectedBy, setCollectedBy] = useState<Record<string, number>>({});
  const [deductibleBy, setDeductibleBy] = useState<Record<string, number>>({});
  const [decls, setDecls] = useState<Declaration[]>([]);
  const [openingCredit, setOpeningCredit] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const start = `${year}-01-01`;
      const end = `${year + 1}-01-01`;
      const [prodRows, saleRows, debitRows, supRes, declRes] = await Promise.all([
        fetchAll<{ id: string; vat_rate: number }>((a, b) =>
          supabase.from("products").select("id,vat_rate").order("id").range(a, b)),
        fetchAll<SaleRow>((a, b) =>
          supabase.from("sales").select("product_id,quantity,sale_price,sale_date")
            .gte("sale_date", start).lt("sale_date", end).order("id").range(a, b)),
        fetchAll<DebitRow>((a, b) =>
          supabase.from("bank_transactions").select("op_date,amount,supplier_id").eq("direction", "debit")
            .not("supplier_id", "is", null).gte("op_date", start).lt("op_date", end).order("id").range(a, b)),
        supabase.from("suppliers").select("*"),
        // déclarations de l'année + dernière de l'année précédente (crédit d'ouverture)
        supabase.from("tva_declarations").select("*").gte("period", `${year - 1}-`).lt("period", `${year + 1}-`),
      ]);
      if (cancelled) return;

      const vatOf = new Map(prodRows.map((p) => [p.id, Number(p.vat_rate) || 0]));
      const col: Record<string, number> = {};
      for (const s of saleRows) {
        const m = s.sale_date.slice(0, 7);
        col[m] = (col[m] ?? 0) + Number(s.quantity) * Number(s.sale_price) * (vatOf.get(s.product_id) ?? 0) / 100;
      }
      const rateOf = new Map(((supRes.data as { id: string; vat_rate?: number | null }[]) ?? []).map((s) => [s.id, s.vat_rate ?? null]));
      const ded: Record<string, number> = {};
      for (const d of debitRows) {
        const m = d.op_date.slice(0, 7);
        ded[m] = (ded[m] ?? 0) + vatFromTTC(Math.abs(Number(d.amount)), rateOf.get(d.supplier_id));
      }

      const all = (declRes.data as Declaration[]) ?? [];
      const thisYear = all.filter((d) => d.period.startsWith(`${year}-`));
      // crédit d'ouverture : résultat de la dernière période déclarée de l'année précédente
      const lastPrev = all.filter((d) => d.period.startsWith(`${year - 1}-`)).sort((a, b) => (a.period < b.period ? 1 : -1))[0];
      setCollectedBy(col);
      setDeductibleBy(ded);
      setDecls(thisYear);
      setOpeningCredit(lastPrev && Number(lastPrev.result) < 0 ? -Number(lastPrev.result) : 0);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase, year]);

  const rows = useMemo<Row[]>(() => {
    const keys = mode === "month"
      ? Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`)
      : [1, 2, 3, 4].map((q) => `${year}-T${q}`);
    const nowKey = periodKey(currentMonth(), mode);
    const byPeriod = new Map(decls.map((d) => [d.period, d]));
    let carry = openingCredit;
    return keys.map((key) => {
      const decl = byPeriod.get(key) ?? null;
      const months = periodMonths(key);
      const liveCol = months.reduce((s, m) => s + (collectedBy[m] ?? 0), 0);
      const liveDed = months.reduce((s, m) => s + (deductibleBy[m] ?? 0), 0);
      const collected = decl ? Number(decl.collected) : liveCol;
      const deductible = decl ? Number(decl.deductible) : liveDed;
      const creditIn = decl ? Number(decl.credit_in) : carry;
      const result = decl ? Number(decl.result) : round2(collected - deductible - creditIn);
      carry = result < 0 ? -result : 0;
      const status: Status = decl
        ? decl.paid_on ? "paid" : Number(decl.result) > 0 ? "declared_unpaid" : "declared"
        : key > nowKey ? "future" : "todo";
      return { key, collected, deductible, creditIn, result, decl, status };
    });
  }, [mode, year, decls, collectedBy, deductibleBy, openingCredit]);

  const past = rows.filter((r) => r.status !== "future");
  const tot = {
    collected: past.reduce((s, r) => s + r.collected, 0),
    deductible: past.reduce((s, r) => s + r.deductible, 0),
    paid: rows.filter((r) => r.status === "paid").reduce((s, r) => s + Math.max(0, r.result), 0),
    unpaid: rows.filter((r) => r.status === "declared_unpaid").reduce((s, r) => s + r.result, 0),
    todo: rows.filter((r) => r.status === "todo").length,
  };
  const lastCredit = [...past].reverse()[0];

  const label = (key: string) =>
    key.includes("-T") ? `${t("tva_quarter")} ${key.slice(-1)}` : monthLabel(key, lang);
  const fmtD = (d: string) =>
    new Intl.DateTimeFormat(lang === "ar" ? "ar-MA" : "fr-FR", { day: "2-digit", month: "short" }).format(new Date(d + "T00:00:00"));

  const badge = (r: Row) => {
    const base = "whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium";
    switch (r.status) {
      case "paid": return <span className={`${base} bg-success/15 text-success`}>✓ {t("tva_status_paid")} · {fmtD(r.decl!.paid_on!)}</span>;
      case "declared_unpaid": return <span className={`${base} bg-danger/10 text-danger`}>{t("tva_status_to_pay")}</span>;
      case "declared": return <span className={`${base} bg-success/15 text-success`}>✓ {t("tva_status_declared")}</span>;
      case "todo": return <span className={`${base} bg-accent/15 text-accent`}>{t("tva_not_declared")}</span>;
      default: return <span className={`${base} text-muted`}>{t("tva_status_future")}</span>;
    }
  };

  function exportCsv() {
    const q = (c: unknown) => `"${String(c).replace(/"/g, '""')}"`;
    const statusFr: Record<Status, string> = {
      paid: "Payée", declared_unpaid: "Déclarée — à payer", declared: "Déclarée", todo: "Non déclarée (estimation)", future: "À venir",
    };
    const lines = [
      ["Période", "TVA collectée", "TVA déductible", "Crédit reporté", "À payer", "Crédit", "Statut", "Déclarée le", "Payée le"],
      ...rows.map((r) => [r.key, r.collected.toFixed(2), r.deductible.toFixed(2), r.creditIn.toFixed(2),
        r.result > 0 ? r.result.toFixed(2) : "", r.result < 0 ? (-r.result).toFixed(2) : "",
        statusFr[r.status], r.decl?.declared_on ?? "", r.decl?.paid_on ?? ""]),
    ];
    const csv = "﻿" + lines.map((l) => l.map(q).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `tva-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <div className="no-print flex flex-wrap items-center gap-2">
        <button onClick={() => setYear(year - 1)} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:bg-background">‹</button>
        <span className="min-w-16 text-center text-lg font-bold">{year}</span>
        <button onClick={() => setYear(year + 1)} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:bg-background">›</button>
        <div className="flex-1" />
        <button onClick={exportCsv} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium hover:bg-background">
          ⬇️ {t("export_csv")}
        </button>
        <button onClick={() => window.print()} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg">
          🖨️ {t("print_pdf")}
        </button>
      </div>

      {loading ? (
        <p className="p-8 text-center text-muted">{t("loading")}</p>
      ) : (
        <div className="print-area space-y-5">
          <div className="card p-5">
            <h2 className="text-xl font-bold">{t("tva_year_title")} {year}</h2>
            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label={t("tva_collected")} value={fmtMoney(tot.collected, lang)} />
              <Stat label={t("tva_deductible")} value={fmtMoney(tot.deductible, lang)} />
              <Stat label={t("tva_year_paid")} value={fmtMoney(tot.paid, lang)} color="text-success" />
              <Stat
                label={t("tva_year_unpaid")}
                value={fmtMoney(tot.unpaid, lang)}
                color={tot.unpaid > 0 ? "text-danger" : undefined}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
              {tot.todo > 0 && <span className="font-medium text-accent">⚠️ {tot.todo} {t("tva_year_todo")}</span>}
              {lastCredit && lastCredit.result < 0 && (
                <span>{t("tva_credit_out")} : <span className="font-semibold text-success">{fmtMoney(-lastCredit.result, lang)}</span></span>
              )}
              <span>{t("tva_year_estimate_hint")}</span>
            </div>
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className="px-4 py-2 text-start font-medium">{t("period")}</th>
                  <th className="px-4 py-2 text-end font-medium">{t("tva_collected")}</th>
                  <th className="px-4 py-2 text-end font-medium">{t("tva_deductible")}</th>
                  <th className="px-4 py-2 text-end font-medium">{t("tva_credit_in")}</th>
                  <th className="px-4 py-2 text-end font-medium">{t("tva_year_result")}</th>
                  <th className="px-4 py-2 text-start font-medium">{t("tva_year_status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => {
                  const estimate = !r.decl;
                  const future = r.status === "future";
                  return (
                    <tr key={r.key} onClick={() => onOpen(r.key)}
                      className={`cursor-pointer hover:bg-background ${future ? "opacity-50" : ""}`}>
                      <td className="px-4 py-2.5 font-medium capitalize">{label(r.key)}</td>
                      <td className={`px-4 py-2.5 text-end ${estimate ? "italic text-muted" : ""}`}>{future ? "—" : fmtMoney(r.collected, lang)}</td>
                      <td className={`px-4 py-2.5 text-end ${estimate ? "italic text-muted" : ""}`}>{future ? "—" : fmtMoney(r.deductible, lang)}</td>
                      <td className={`px-4 py-2.5 text-end ${estimate ? "italic text-muted" : ""}`}>{future || !r.creditIn ? "—" : fmtMoney(r.creditIn, lang)}</td>
                      <td className={`px-4 py-2.5 text-end font-semibold ${r.result > 0 ? "text-danger" : r.result < 0 ? "text-success" : ""} ${estimate ? "italic" : ""}`}>
                        {future ? "—" : r.result >= 0 ? fmtMoney(r.result, lang) : `${t("tva_year_credit")} ${fmtMoney(-r.result, lang)}`}
                      </td>
                      <td className="px-4 py-2.5">{badge(r)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="no-print text-xs text-muted">{t("tva_year_click_hint")}</p>
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
