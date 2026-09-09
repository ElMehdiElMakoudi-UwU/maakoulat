"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { currentMonth, fmtMoney, monthLabel, monthRange } from "@/lib/format";
import type { BankStatement, BankTransaction, BankTxKind, Supplier } from "@/lib/types";

interface ParsedTx {
  op_date: string;
  value_date: string | null;
  label: string;
  op_ref: string | null;
  amount: number;
  direction: "debit" | "credit";
  kind: BankTxKind;
  charge_cat: string | null;
  fingerprint: string;
}
interface ParseResult {
  ok: true;
  filename: string;
  period_start: string | null;
  period_end: string | null;
  opening_balance: number;
  closing_balance: number;
  total_debit: number;
  total_credit: number;
  transactions: ParsedTx[];
  sum_debit: number;
  sum_credit: number;
  balances_ok: boolean;
  totals_ok: boolean;
  warnings: string[];
}

const KINDS: BankTxKind[] = ["encaissement", "paiement_frs", "apport", "charge", "autre"];
type Filter = "all" | "deposits" | "supplier" | "charges" | "todo";

export default function BanquePage() {
  const { t, lang } = useI18n();
  const supabase = useMemo(() => createClient(), []);
  const fileRef = useRef<HTMLInputElement>(null);

  const [month, setMonth] = useState(currentMonth());
  const [loading, setLoading] = useState(true);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [statements, setStatements] = useState<BankStatement[]>([]);
  const [txs, setTxs] = useState<BankTransaction[]>([]);
  const [filter, setFilter] = useState<Filter>("all");

  // import
  const [analyzing, setAnalyzing] = useState(false);
  const [preview, setPreview] = useState<ParseResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  // rapprochement : fournisseur choisi par ligne (avant validation)
  const [pick, setPick] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const { start, end } = monthRange(month);
    const [supRes, stRes, txRes] = await Promise.all([
      supabase.from("suppliers").select("*").order("sort_order"),
      supabase.from("bank_statements").select("*").order("period_start", { ascending: false }),
      supabase
        .from("bank_transactions")
        .select("*")
        .gte("op_date", start)
        .lt("op_date", end)
        .order("op_date"),
    ]);
    setSuppliers((supRes.data as Supplier[]) ?? []);
    setStatements((stRes.data as BankStatement[]) ?? []);
    setTxs((txRes.data as BankTransaction[]) ?? []);
    setLoading(false);
  }, [supabase, month]);

  useEffect(() => {
    load();
  }, [load]);

  function showFlash(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 4000);
  }

  // ---------- Import PDF ----------
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setAnalyzing(true);
    setPreview(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/parse-statement", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        showFlash(t("bank_parse_failed"));
      } else if (!json.transactions?.length) {
        showFlash(t("bank_parse_failed"));
      } else {
        setPreview(json as ParseResult);
      }
    } catch {
      showFlash(t("bank_parse_failed"));
    } finally {
      setAnalyzing(false);
    }
  }

  async function confirmImport() {
    if (!preview) return;
    setImporting(true);
    try {
      const { data: stmt, error: e1 } = await supabase
        .from("bank_statements")
        .insert({
          filename: preview.filename,
          period_start: preview.period_start,
          period_end: preview.period_end,
          opening_balance: preview.opening_balance,
          closing_balance: preview.closing_balance,
          total_debit: preview.total_debit,
          total_credit: preview.total_credit,
          tx_count: preview.transactions.length,
        })
        .select()
        .single();
      if (e1 || !stmt) throw e1;

      const fps = preview.transactions.map((x) => x.fingerprint);
      const { data: existing } = await supabase
        .from("bank_transactions")
        .select("fingerprint")
        .in("fingerprint", fps);
      const seen = new Set((existing ?? []).map((r: { fingerprint: string }) => r.fingerprint));

      const rows = preview.transactions
        .filter((x) => !seen.has(x.fingerprint))
        .map((x) => ({
          statement_id: (stmt as BankStatement).id,
          op_date: x.op_date,
          value_date: x.value_date,
          label: x.label,
          op_ref: x.op_ref,
          amount: x.amount,
          direction: x.direction,
          kind: x.kind,
          charge_cat: x.charge_cat,
          fingerprint: x.fingerprint,
        }));

      if (rows.length) {
        const { error: e2 } = await supabase.from("bank_transactions").insert(rows);
        if (e2) throw e2;
      }
      const dup = preview.transactions.length - rows.length;
      showFlash(
        rows.length
          ? `${t("bank_imported")}${dup ? ` — ${dup} ${t("bank_dup_skipped")}` : ""}`
          : t("bank_nothing_new")
      );
      // se placer sur le mois du relevé
      if (preview.period_start) setMonth(preview.period_start.slice(0, 7));
      setPreview(null);
      await load();
    } catch (err) {
      console.error(err);
      showFlash(t("bank_parse_failed"));
    } finally {
      setImporting(false);
    }
  }

  async function deleteStatement(st: BankStatement) {
    if (!confirm(t("bank_delete_statement"))) return;
    // supprimer d'abord les paiements fournisseurs créés par rapprochement
    const { data: linked } = await supabase
      .from("bank_transactions")
      .select("payment_id")
      .eq("statement_id", st.id)
      .not("payment_id", "is", null);
    const payIds = (linked ?? []).map((r: { payment_id: string }) => r.payment_id).filter(Boolean);
    if (payIds.length) await supabase.from("supplier_payments").delete().in("id", payIds);
    await supabase.from("bank_statements").delete().eq("id", st.id); // cascade → transactions
    await load();
  }

  // ---------- Édition catégorie ----------
  async function setKind(tx: BankTransaction, kind: BankTxKind) {
    // si on retire la catégorie "paiement fournisseur" d'une ligne rapprochée,
    // on annule d'abord le rapprochement (sinon paiement orphelin).
    if (tx.reconciled && kind !== "paiement_frs") await unreconcile(tx);
    setTxs((old) => old.map((x) => (x.id === tx.id ? { ...x, kind } : x)));
    await supabase.from("bank_transactions").update({ kind }).eq("id", tx.id);
  }

  // ---------- Rapprochement fournisseur ----------
  async function reconcile(tx: BankTransaction) {
    const supplierId = pick[tx.id];
    if (!supplierId) return;
    const amount = Math.abs(Number(tx.amount));
    const { data: pay, error } = await supabase
      .from("supplier_payments")
      .insert({
        supplier_id: supplierId,
        pay_date: tx.op_date,
        amount,
        note: `Relevé — ${tx.label}`,
        bank_transaction_id: tx.id,
      })
      .select()
      .single();
    if (error || !pay) {
      showFlash(t("bank_parse_failed"));
      return;
    }
    const patch = {
      supplier_id: supplierId,
      reconciled: true,
      payment_id: (pay as { id: string }).id,
      kind: "paiement_frs" as BankTxKind,
    };
    setTxs((old) => old.map((x) => (x.id === tx.id ? { ...x, ...patch } : x)));
    await supabase.from("bank_transactions").update(patch).eq("id", tx.id);
    setPick((p) => {
      const n = { ...p };
      delete n[tx.id];
      return n;
    });
  }

  async function unreconcile(tx: BankTransaction) {
    if (tx.payment_id) await supabase.from("supplier_payments").delete().eq("id", tx.payment_id);
    const patch = { reconciled: false, payment_id: null, supplier_id: null };
    setTxs((old) => old.map((x) => (x.id === tx.id ? { ...x, ...patch } : x)));
    await supabase.from("bank_transactions").update(patch).eq("id", tx.id);
  }

  // ---------- Dérivés ----------
  const kpis = useMemo(() => {
    let dep = 0,
      frs = 0,
      chg = 0,
      todo = 0;
    for (const x of txs) {
      const a = Number(x.amount);
      if (x.kind === "encaissement") dep += a;
      else if (x.kind === "paiement_frs") {
        frs += -a;
        if (!x.reconciled) todo++;
      } else if (x.kind === "charge") chg += -a;
    }
    return { dep, frs, chg, todo };
  }, [txs]);

  const visible = useMemo(() => {
    return txs.filter((x) => {
      if (filter === "deposits") return x.kind === "encaissement";
      if (filter === "supplier") return x.kind === "paiement_frs";
      if (filter === "charges") return x.kind === "charge";
      if (filter === "todo") return x.kind === "paiement_frs" && !x.reconciled;
      return true;
    });
  }, [txs, filter]);

  const supName = (id: string | null) => suppliers.find((s) => s.id === id)?.name ?? "";

  return (
    <div>
      <input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden onChange={onFile} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("bank_title")}</h1>
          <p className="max-w-xl text-sm text-muted">{t("bank_hint")}</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-2 outline-none focus:border-primary"
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={analyzing}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg disabled:opacity-50"
          >
            {analyzing ? t("bank_analyzing") : `📄 ${t("bank_import")}`}
          </button>
        </div>
      </div>

      {flash && (
        <div className="mb-4 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm text-primary">
          {flash}
        </div>
      )}

      {/* ---------- Aperçu avant import ---------- */}
      {preview && (
        <div className="card mb-5 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold">
              {t("bank_preview")} — {preview.filename}
            </h2>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                preview.balances_ok && preview.totals_ok
                  ? "bg-success/15 text-success"
                  : "bg-accent/15 text-accent"
              }`}
            >
              {preview.balances_ok && preview.totals_ok ? t("bank_check_ok") : t("bank_check_warn")}
            </span>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Mini label={t("bank_opening")} value={fmtMoney(preview.opening_balance, lang)} />
            <Mini label={t("bank_total_credit")} value={fmtMoney(preview.total_credit, lang)} accent="success" />
            <Mini label={t("bank_total_debit")} value={fmtMoney(preview.total_debit, lang)} accent="danger" />
            <Mini label={t("bank_closing")} value={fmtMoney(preview.closing_balance, lang)} />
          </div>

          {preview.warnings.length > 0 && (
            <ul className="mb-3 list-disc space-y-1 ps-5 text-xs text-accent">
              {preview.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}

          <div className="max-h-72 overflow-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background text-muted">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">{t("bank_op_date")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("label")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("bank_kind")}</th>
                  <th className="px-3 py-2 text-end font-medium">{t("bank_debit")}</th>
                  <th className="px-3 py-2 text-end font-medium">{t("bank_credit")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {preview.transactions.map((x, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap px-3 py-1.5">{x.op_date.slice(5)}</td>
                    <td className="px-3 py-1.5">{x.label}</td>
                    <td className="px-3 py-1.5 text-muted">{t(`kind_${x.kind}`)}</td>
                    <td className="px-3 py-1.5 text-end text-danger">
                      {x.direction === "debit" ? fmtMoney(-x.amount, lang) : ""}
                    </td>
                    <td className="px-3 py-1.5 text-end text-success">
                      {x.direction === "credit" ? fmtMoney(x.amount, lang) : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={confirmImport}
              disabled={importing}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg disabled:opacity-50"
            >
              {importing ? t("bank_importing") : `${t("bank_confirm_import")} (${preview.transactions.length})`}
            </button>
            <button
              onClick={() => setPreview(null)}
              className="rounded-lg border border-border px-4 py-2 text-sm"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="p-8 text-center text-muted">{t("loading")}</p>
      ) : (
        <>
          {/* ---------- KPIs du mois ---------- */}
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Mini label={t("bank_deposits_month")} value={fmtMoney(kpis.dep, lang)} accent="success" />
            <Mini label={t("bank_supplier_pay_month")} value={fmtMoney(kpis.frs, lang)} accent="danger" />
            <Mini label={t("bank_filter_charges")} value={fmtMoney(kpis.chg, lang)} accent="danger" />
            <Mini
              label={t("bank_to_reconcile_count")}
              value={String(kpis.todo)}
              accent={kpis.todo ? "accent" : "muted"}
            />
          </div>

          {/* ---------- Filtres ---------- */}
          <div className="mb-3 flex flex-wrap gap-1.5">
            {(
              [
                ["all", t("bank_filter_all")],
                ["deposits", t("bank_filter_deposits")],
                ["supplier", t("bank_filter_supplier")],
                ["charges", t("bank_filter_charges")],
                ["todo", t("bank_filter_todo")],
              ] as [Filter, string][]
            ).map(([k, lbl]) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  filter === k ? "bg-primary text-primary-fg" : "bg-surface border border-border"
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>

          {filter === "supplier" || filter === "todo" ? (
            <p className="mb-2 text-xs text-muted">{t("bank_reconcile_hint")}</p>
          ) : null}

          {/* ---------- Table des mouvements ---------- */}
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className="px-3 py-2 text-start font-medium">{t("bank_op_date")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("label")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("bank_kind")}</th>
                  <th className="px-3 py-2 text-end font-medium">{t("bank_debit")}</th>
                  <th className="px-3 py-2 text-end font-medium">{t("bank_credit")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("bank_reconcile")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((x) => {
                  const a = Number(x.amount);
                  const isDebit = x.direction === "debit";
                  return (
                    <tr key={x.id} className={x.reconciled ? "bg-success/5" : ""}>
                      <td className="whitespace-nowrap px-3 py-2">{x.op_date.slice(5)}</td>
                      <td className="px-3 py-2">
                        <div>{x.label}</div>
                        {x.op_ref && <div className="text-xs text-muted">{x.op_ref}</div>}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={x.kind}
                          onChange={(e) => setKind(x, e.target.value as BankTxKind)}
                          className="rounded border border-transparent bg-transparent py-1 text-sm hover:border-border focus:border-primary focus:outline-none"
                        >
                          {KINDS.map((k) => (
                            <option key={k} value={k}>
                              {t(`kind_${k}`)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-end font-medium text-danger">
                        {isDebit ? fmtMoney(-a, lang) : ""}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-end font-medium text-success">
                        {!isDebit ? fmtMoney(a, lang) : ""}
                      </td>
                      <td className="px-3 py-2">
                        {x.kind !== "paiement_frs" ? (
                          <span className="text-xs text-muted">—</span>
                        ) : x.reconciled ? (
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
                              {supName(x.supplier_id) || t("bank_reconciled")}
                            </span>
                            <button
                              onClick={() => unreconcile(x)}
                              className="text-xs text-danger hover:underline"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <select
                              value={pick[x.id] ?? ""}
                              onChange={(e) => setPick((p) => ({ ...p, [x.id]: e.target.value }))}
                              className="input max-w-[10rem] py-1 text-sm"
                            >
                              <option value="">{t("bank_pick_supplier")}</option>
                              {suppliers
                                .filter((s) => s.active)
                                .map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.name}
                                  </option>
                                ))}
                            </select>
                            <button
                              onClick={() => reconcile(x)}
                              disabled={!pick[x.id]}
                              className="rounded-lg bg-primary px-2.5 py-1 text-xs font-semibold text-primary-fg disabled:opacity-40"
                            >
                              ✓
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-muted">
                      {txs.length ? t("no_data") : t("bank_no_tx")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ---------- Relevés importés ---------- */}
          {statements.length > 0 && (
            <div className="mt-6">
              <h2 className="mb-2 font-bold">{t("bank_statements")}</h2>
              <div className="card divide-y divide-border">
                {statements.map((st) => (
                  <div key={st.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <div>
                      <div className="font-medium">
                        {st.period_start ? monthLabel(st.period_start.slice(0, 7), lang) : st.filename}
                      </div>
                      <div className="text-xs text-muted">
                        {st.tx_count} {t("bank_movements").toLowerCase()} · {t("bank_closing")}{" "}
                        {fmtMoney(Number(st.closing_balance), lang)}
                      </div>
                    </div>
                    <button
                      onClick={() => deleteStatement(st)}
                      className="rounded-lg border border-border px-2.5 py-1 text-xs text-danger hover:bg-background"
                    >
                      {t("delete")}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Mini({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "success" | "danger" | "accent" | "muted";
}) {
  const color =
    accent === "success"
      ? "text-success"
      : accent === "danger"
        ? "text-danger"
        : accent === "accent"
          ? "text-accent"
          : accent === "muted"
            ? "text-muted"
            : "text-foreground";
  return (
    <div className="card p-3">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={`mt-0.5 text-lg font-bold ${color}`}>{value}</div>
    </div>
  );
}
