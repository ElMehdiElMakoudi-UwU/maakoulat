"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { fmtMoney, today } from "@/lib/format";
import { annuityPayment, loanSchedule, loanSummary, upcomingEcheances } from "@/lib/loans";
import type { BankLoan } from "@/lib/types";

const fmtDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

const EMPTY_FORM = {
  bank: "", label: "", principal: "", interest_rate: "", monthly_payment: "",
  first_due_date: "", payment_day: "", duration_months: "", note: "",
};

export default function CreditsPage() {
  const { t, lang } = useI18n();
  const supabase = useMemo(() => createClient(), []);
  const todayStr = today();

  const [loading, setLoading] = useState(true);
  const [missingTable, setMissingTable] = useState(false);
  const [loans, setLoans] = useState<BankLoan[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("bank_loans").select("*").order("first_due_date");
    if (error) setMissingTable(true);
    else setLoans((data as BankLoan[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const active = loans.filter((l) => l.status === "active");
  const summaries = useMemo(() => new Map(loans.map((l) => [l.id, loanSummary(l, todayStr)])), [loans, todayStr]);
  const upcoming = useMemo(() => upcomingEcheances(loans, todayStr), [loans, todayStr]);
  const thisMonth = todayStr.slice(0, 7);
  const dueThisMonth = upcoming.filter((e) => e.date.slice(0, 7) === thisMonth).reduce((a, e) => a + e.amount, 0);
  const outstanding = active.reduce((a, l) => a + (summaries.get(l.id)?.remainingCapital ?? 0), 0);
  const monthlyTotal = active.reduce((a, l) => a + Number(l.monthly_payment), 0);
  const loanName = (l: BankLoan) => [l.bank, l.label].filter(Boolean).join(" — ") || "—";
  const byId = new Map(loans.map((l) => [l.id, l]));

  // Mensualité théorique (si capital, taux et durée sont saisis)
  const principal = parseFloat(form.principal) || 0;
  const months = parseInt(form.duration_months) || 0;
  const payDay = parseInt(form.payment_day) || 0;
  const rate = parseFloat(form.interest_rate) || 0;
  const theoretical = principal > 0 && months > 0 ? annuityPayment(principal, rate, months) : 0;
  const payment = parseFloat(form.monthly_payment) || 0;
  const canSave = payment > 0 && months > 0 && !!form.first_due_date && payDay >= 1 && payDay <= 31
    && !!(form.bank.trim() || form.label.trim());

  async function save() {
    if (!canSave) return;
    const row = {
      bank: form.bank.trim(),
      label: form.label.trim(),
      principal,
      interest_rate: rate,
      monthly_payment: payment,
      first_due_date: form.first_due_date,
      payment_day: payDay,
      duration_months: months,
      note: form.note.trim() || null,
    };
    if (editingId) await supabase.from("bank_loans").update(row).eq("id", editingId);
    else await supabase.from("bank_loans").insert(row);
    setForm(EMPTY_FORM);
    setEditingId(null);
    await load();
  }

  function startEdit(l: BankLoan) {
    setEditingId(l.id);
    setForm({
      bank: l.bank, label: l.label, principal: String(l.principal), interest_rate: String(l.interest_rate),
      monthly_payment: String(l.monthly_payment), first_due_date: l.first_due_date,
      payment_day: String(l.payment_day ?? Number(l.first_due_date.slice(8, 10))),
      duration_months: String(l.duration_months), note: l.note ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function toggleStatus(l: BankLoan) {
    await supabase.from("bank_loans").update({ status: l.status === "active" ? "closed" : "active" }).eq("id", l.id);
    await load();
  }

  async function remove(l: BankLoan) {
    if (!confirm(t("confirm_delete"))) return;
    await supabase.from("bank_loans").delete().eq("id", l.id);
    await load();
  }

  if (loading) return <p className="p-8 text-center text-muted">{t("loading")}</p>;

  if (missingTable) {
    return (
      <div>
        <h1 className="mb-4 text-2xl font-bold">{t("loan_title")}</h1>
        <div className="rounded-xl border border-accent/40 bg-accent/5 px-4 py-3 text-sm">{t("loan_missing_table")}</div>
      </div>
    );
  }

  const listed = showClosed ? loans : active;

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold">{t("loan_title")}</h1>
        <p className="text-sm text-muted">{t("loan_subtitle")}</p>
      </div>

      {/* KPI */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("loan_outstanding")} value={fmtMoney(outstanding, lang)} sub={`${active.length} ${t("loan_active_loans")}`} />
        <Kpi label={t("loan_monthly_total")} value={fmtMoney(monthlyTotal, lang)} sub={t("loan_per_month")} />
        <Kpi label={t("loan_due_this_month")} value={fmtMoney(dueThisMonth, lang)} sub={t("loan_remaining_this_month")} accent="danger" />
        <Kpi
          label={t("loan_next_due")}
          value={upcoming[0] ? fmtDate(upcoming[0].date) : "—"}
          sub={upcoming[0] ? `${fmtMoney(upcoming[0].amount, lang)} · ${loanName(byId.get(upcoming[0].loanId)!)}` : ""}
        />
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-3">
        {/* Formulaire */}
        <div className="card p-4 lg:col-span-1">
          <h2 className="mb-3 font-bold">{editingId ? t("loan_edit") : t("loan_add")}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("loan_bank")}>
              <input className="input" value={form.bank} onChange={(e) => setForm({ ...form, bank: e.target.value })} />
            </Field>
            <Field label={t("loan_label")}>
              <input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            </Field>
            <Field label={t("loan_principal")}>
              <input type="number" min={0} className="input" value={form.principal}
                onChange={(e) => setForm({ ...form, principal: e.target.value })} />
            </Field>
            <Field label={t("loan_rate")}>
              <input type="number" min={0} step={0.01} className="input" value={form.interest_rate}
                onChange={(e) => setForm({ ...form, interest_rate: e.target.value })} />
            </Field>
            <Field label={t("loan_duration")}>
              <input type="number" min={1} className="input" value={form.duration_months}
                onChange={(e) => setForm({ ...form, duration_months: e.target.value })} />
            </Field>
            <Field label={t("loan_first_due")}>
              <input type="date" className="input" value={form.first_due_date}
                onChange={(e) => setForm({
                  ...form,
                  first_due_date: e.target.value,
                  // Le jour de prélèvement suit la 1re échéance tant qu'il n'a pas été saisi
                  payment_day: form.payment_day || (e.target.value ? String(Number(e.target.value.slice(8, 10))) : ""),
                })} />
            </Field>
            <Field label={t("loan_payment_day")}>
              <input type="number" min={1} max={31} className="input" value={form.payment_day}
                onChange={(e) => setForm({ ...form, payment_day: e.target.value })} />
            </Field>
            <div className="sm:col-span-2">
              <Field label={t("loan_monthly_payment")}>
                <input type="number" min={0} className="input" value={form.monthly_payment}
                  onChange={(e) => setForm({ ...form, monthly_payment: e.target.value })} />
              </Field>
              {theoretical > 0 && (
                <button
                  onClick={() => setForm({ ...form, monthly_payment: theoretical.toFixed(2) })}
                  className="mt-1 text-xs text-primary hover:underline"
                >
                  {t("loan_use_theoretical")} {fmtMoney(theoretical, lang)}
                </button>
              )}
            </div>
            <div className="sm:col-span-2">
              <Field label={t("note")}>
                <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </Field>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={save} disabled={!canSave}
              className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg disabled:opacity-50">
              {editingId ? t("save") : t("add")}
            </button>
            {editingId && (
              <button onClick={() => { setEditingId(null); setForm(EMPTY_FORM); }}
                className="rounded-lg border border-border px-4 py-2 text-sm">
                {t("cancel")}
              </button>
            )}
          </div>
        </div>

        {/* Prochaines échéances */}
        <div className="card p-4 lg:col-span-2">
          <h2 className="font-bold">{t("loan_upcoming")}</h2>
          <p className="mb-3 text-xs text-muted">{t("loan_upcoming_hint")}</p>
          {upcoming.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">{t("loan_none")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className="py-2 text-start font-medium">{t("due_date")}</th>
                  <th className="py-2 text-start font-medium">{t("loan_loan")}</th>
                  <th className="py-2 text-end font-medium">{t("loan_installment")}</th>
                  <th className="py-2 text-end font-medium">{t("amount")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {upcoming.slice(0, 8).map((e) => {
                  const l = byId.get(e.loanId)!;
                  return (
                    <tr key={`${e.loanId}-${e.n}`}>
                      <td className="py-2"><bdi dir="ltr">{fmtDate(e.date)}</bdi></td>
                      <td className="py-2 font-medium">{loanName(l)}</td>
                      <td className="py-2 text-end text-muted">{e.n}/{l.duration_months}</td>
                      <td className="py-2 text-end font-semibold">{fmtMoney(e.amount, lang)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Liste des crédits */}
      <div className="card overflow-x-auto">
        <div className="flex items-center justify-between px-4 pt-4">
          <h2 className="font-bold">{t("loan_list")}</h2>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
            {t("loan_show_closed")}
          </label>
        </div>
        {listed.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted">{t("loan_none")}</p>
        ) : (
          <table className="mt-2 w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="px-4 py-2 text-start font-medium">{t("loan_loan")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("loan_principal")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("loan_monthly_payment")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("loan_progress")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("loan_remaining_capital")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("loan_next_due")}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {listed.map((l) => {
                const s = summaries.get(l.id)!;
                const pct = (s.paidCount / l.duration_months) * 100;
                const open = openId === l.id;
                return (
                  <Fragment key={l.id}>
                    <tr className={l.status === "closed" ? "opacity-60" : ""}>
                      <td className="px-4 py-2">
                        <div className="font-medium">{loanName(l)}</div>
                        <div className="text-xs text-muted">
                          {t("loan_paid_on")} {l.payment_day ?? Number(l.first_due_date.slice(8, 10))} {t("loan_each_month")} ·{" "}
                          {Number(l.interest_rate) > 0 && <>{l.interest_rate} % · </>}
                          {t("loan_until")} <bdi dir="ltr">{fmtDate(s.end)}</bdi>
                          {l.note && <> · {l.note}</>}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-end">{fmtMoney(Number(l.principal), lang)}</td>
                      <td className="px-4 py-2 text-end font-semibold">{fmtMoney(Number(l.monthly_payment), lang)}</td>
                      <td className="px-4 py-2">
                        <div className="h-2 w-32 overflow-hidden rounded-full bg-border">
                          <div className="h-full bg-success" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="mt-0.5 text-xs text-muted">{s.paidCount}/{l.duration_months} · {t("loan_left_to_pay")} {fmtMoney(s.remainingToPay, lang)}</div>
                      </td>
                      <td className="px-4 py-2 text-end">{fmtMoney(s.remainingCapital, lang)}</td>
                      <td className="px-4 py-2">{s.next ? <bdi dir="ltr">{fmtDate(s.next.date)}</bdi> : <span className="text-success">{t("loan_finished")}</span>}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-end">
                        <button onClick={() => setOpenId(open ? null : l.id)} className="me-3 text-xs text-primary hover:underline">
                          {t("loan_schedule")}
                        </button>
                        <button onClick={() => startEdit(l)} className="me-3 text-xs hover:underline">{t("edit")}</button>
                        <button onClick={() => toggleStatus(l)} className="me-3 text-xs text-muted hover:underline">
                          {l.status === "active" ? t("loan_close") : t("loan_reopen")}
                        </button>
                        <button onClick={() => remove(l)} className="text-xs text-danger hover:underline">{t("delete")}</button>
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={7} className="bg-background/60 px-4 py-3">
                          <div className="max-h-80 overflow-y-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-muted">
                                  <th className="py-1 text-start font-medium">#</th>
                                  <th className="py-1 text-start font-medium">{t("due_date")}</th>
                                  <th className="py-1 text-end font-medium">{t("loan_installment")}</th>
                                  <th className="py-1 text-end font-medium">{t("loan_interest")}</th>
                                  <th className="py-1 text-end font-medium">{t("loan_capital")}</th>
                                  <th className="py-1 text-end font-medium">{t("loan_remaining_capital")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {loanSchedule(l).map((e) => (
                                  <tr key={e.n} className={e.date < todayStr ? "text-muted" : ""}>
                                    <td className="py-0.5">{e.n}</td>
                                    <td className="py-0.5"><bdi dir="ltr">{fmtDate(e.date)}</bdi>{e.date < todayStr && " ✓"}</td>
                                    <td className="py-0.5 text-end">{fmtMoney(e.amount, lang)}</td>
                                    <td className="py-0.5 text-end">{fmtMoney(e.interest, lang)}</td>
                                    <td className="py-0.5 text-end">{fmtMoney(e.capital, lang)}</td>
                                    <td className="py-0.5 text-end">{fmtMoney(e.remainingCapital, lang)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "success" | "danger" }) {
  const color = accent === "success" ? "text-success" : accent === "danger" ? "text-danger" : "text-foreground";
  return (
    <div className="card p-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={`mt-1 text-xl font-bold ${color}`}>{value}</div>
      {sub && <div className="truncate text-xs text-muted">{sub}</div>}
    </div>
  );
}
