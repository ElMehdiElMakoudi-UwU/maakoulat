"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { fmtDays, fmtMoney, fmtNum, today } from "@/lib/format";
import type { Supplier, SupplierPayment, SupplierInvoice } from "@/lib/types";
import { addDays, allocateInvoices, dueSummary, type OpenInvoice } from "@/lib/supplierDues";

type MovementKind = "invoice" | "payment";
interface Movement {
  id: string;
  kind: MovementKind;
  date: string;
  amount: number;
  note: string | null;
}

const emptyForm = {
  name: "",
  phone: "",
  email: "",
  address: "",
  contact_name: "",
  notes: "",
  payment_terms_days: "0",
  active: true,
};
type SupForm = typeof emptyForm;

export default function FournisseursPage() {
  const { t, lang } = useI18n();
  const supabase = useMemo(() => createClient(), []);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([]);
  const [payments, setPayments] = useState<SupplierPayment[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [dueFilter, setDueFilter] = useState<"overdue" | "7d" | "30d" | "all">("7d");

  // Formulaire ajout / édition d'un fournisseur
  const [editingId, setEditingId] = useState<string | null>(null); // null + formOpen => ajout
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<SupForm>(emptyForm);

  async function loadAll() {
    setLoading(true);
    const [supRes, invRes, payRes] = await Promise.all([
      supabase.from("suppliers").select("*").order("sort_order"),
      supabase.from("supplier_invoices").select("*"),
      supabase.from("supplier_payments").select("*"),
    ]);
    setSuppliers((supRes.data as Supplier[]) ?? []);
    setInvoices((invRes.data as SupplierInvoice[]) ?? []);
    setPayments((payRes.data as SupplierPayment[]) ?? []);
    setLoading(false);
  }
  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Totaux (commandé / payé / dû) par fournisseur, tous mois confondus
  const totals = useMemo(() => {
    const ordered = new Map<string, number>();
    const paid = new Map<string, number>();
    for (const i of invoices) ordered.set(i.supplier_id, (ordered.get(i.supplier_id) ?? 0) + Number(i.amount));
    for (const p of payments) paid.set(p.supplier_id, (paid.get(p.supplier_id) ?? 0) + Number(p.amount));
    const map = new Map<string, { ordered: number; paid: number; due: number }>();
    for (const s of suppliers) {
      const o = ordered.get(s.id) ?? 0;
      const pd = paid.get(s.id) ?? 0;
      map.set(s.id, { ordered: o, paid: pd, due: o - pd });
    }
    return map;
  }, [invoices, payments, suppliers]);

  const totalDueAll = useMemo(
    () => Array.from(totals.values()).reduce((s, v) => s + v.due, 0),
    [totals]
  );
  const nbWithDebt = useMemo(
    () => Array.from(totals.values()).filter((v) => v.due > 0.005).length,
    [totals]
  );

  // Échéances : reste à payer par facture (paiements imputés en FIFO)
  const todayStr = today();
  const allocated = useMemo(
    () => allocateInvoices(suppliers, invoices, payments, todayStr),
    [suppliers, invoices, payments, todayStr]
  );
  const summary = useMemo(() => dueSummary(allocated), [allocated]);
  const overdueBySupplier = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of allocated) if (r.status === "overdue") m.set(r.supplier_id, (m.get(r.supplier_id) ?? 0) + r.remaining);
    return m;
  }, [allocated]);
  const schedule = useMemo(() => {
    const maxDays = dueFilter === "7d" ? 7 : dueFilter === "30d" ? 30 : dueFilter === "overdue" ? -1 : Infinity;
    return allocated
      .filter((r) => r.status !== "paid" && r.days <= maxDays)
      .sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0));
  }, [allocated, dueFilter]);
  const scheduleTotal = schedule.reduce((sum, r) => sum + r.remaining, 0);
  const supplierName = (id: string) => suppliers.find((s) => s.id === id)?.name ?? "—";

  const visibleSuppliers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return suppliers
      .filter((s) => (showInactive ? true : s.active))
      .filter((s) => {
        if (!q) return true;
        return (
          s.name.toLowerCase().includes(q) ||
          (s.contact_name ?? "").toLowerCase().includes(q) ||
          (s.phone ?? "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (totals.get(b.id)?.due ?? 0) - (totals.get(a.id)?.due ?? 0));
  }, [suppliers, search, showInactive, totals]);

  const selected = suppliers.find((s) => s.id === selectedId) ?? null;

  // ---- CRUD fournisseur ----
  function openAdd() {
    setForm(emptyForm);
    setEditingId(null);
    setFormOpen(true);
  }
  function openEdit(s: Supplier) {
    setForm({
      name: s.name,
      phone: s.phone ?? "",
      email: s.email ?? "",
      address: s.address ?? "",
      contact_name: s.contact_name ?? "",
      notes: s.notes ?? "",
      payment_terms_days: String(s.payment_terms_days ?? 0),
      active: s.active,
    });
    setEditingId(s.id);
    setFormOpen(true);
  }
  async function saveSupplier() {
    if (!form.name.trim()) return;
    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      address: form.address.trim() || null,
      contact_name: form.contact_name.trim() || null,
      notes: form.notes.trim() || null,
      payment_terms_days: Math.max(0, parseInt(form.payment_terms_days, 10) || 0),
      active: form.active,
    };
    if (editingId) {
      await supabase.from("suppliers").update(payload).eq("id", editingId);
    } else {
      const maxOrder = suppliers.reduce((m, s) => Math.max(m, s.sort_order), 0);
      await supabase.from("suppliers").insert({ ...payload, sort_order: maxOrder + 1 });
    }
    setFormOpen(false);
    setEditingId(null);
    await loadAll();
  }
  async function deleteSupplier(s: Supplier) {
    if (!confirm(t("confirm_delete_supplier"))) return;
    await supabase.from("suppliers").delete().eq("id", s.id);
    if (selectedId === s.id) setSelectedId(null);
    await loadAll();
  }

  if (loading) {
    return <p className="p-8 text-center text-muted">{t("loading")}</p>;
  }

  // ================= FICHE FOURNISSEUR =================
  if (selected) {
    return (
      <SupplierDetail
        supplier={selected}
        invoices={invoices.filter((i) => i.supplier_id === selected.id)}
        payments={payments.filter((p) => p.supplier_id === selected.id)}
        totals={totals.get(selected.id) ?? { ordered: 0, paid: 0, due: 0 }}
        allocated={allocated.filter((r) => r.supplier_id === selected.id)}
        onBack={() => setSelectedId(null)}
        onEdit={() => openEdit(selected)}
        onChanged={loadAll}
        supabase={supabase}
        t={t}
        lang={lang}
      />
    );
  }

  // ================= LISTE MAÎTRE =================
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("suppliers_manage_title")}</h1>
        <button
          onClick={openAdd}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg hover:opacity-90"
        >
          + {t("add_supplier")}
        </button>
      </div>

      {/* KPI global */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="card p-3">
          <div className="text-xs text-muted">{t("supplier_count")}</div>
          <div className="text-xl font-bold">{fmtNum(suppliers.length, lang)}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">{t("total_due_all")}</div>
          <div className={`text-xl font-bold ${totalDueAll > 0 ? "text-danger" : "text-success"}`}>
            {fmtMoney(totalDueAll, lang)}
          </div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">{t("with_debt")}</div>
          <div className="text-xl font-bold">{fmtNum(nbWithDebt, lang)}</div>
        </div>
        <button onClick={() => setDueFilter("overdue")} className="card p-3 text-start hover:border-danger">
          <div className="text-xs text-muted">{t("overdue_total")} ({fmtNum(summary.overdueCount, lang)})</div>
          <div className={`text-xl font-bold ${summary.overdue > 0 ? "text-danger" : ""}`}>{fmtMoney(summary.overdue, lang)}</div>
        </button>
        <button onClick={() => setDueFilter("7d")} className="card p-3 text-start hover:border-accent">
          <div className="text-xs text-muted">{t("due_7_days")} ({fmtNum(summary.dueSoonCount, lang)})</div>
          <div className={`text-xl font-bold ${summary.dueSoon > 0 ? "text-accent" : ""}`}>{fmtMoney(summary.dueSoon, lang)}</div>
        </button>
      </div>

      {/* Échéancier */}
      <div className="mb-6">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold">{t("schedule_title")}</h2>
            <p className="text-xs text-muted">{t("schedule_hint")}</p>
          </div>
          <div className="flex gap-1">
            {(["overdue", "7d", "30d", "all"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setDueFilter(f)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  dueFilter === f ? "bg-primary text-primary-fg" : "border border-border"
                }`}
              >
                {t(f === "overdue" ? "filter_overdue" : f === "7d" ? "filter_7d" : f === "30d" ? "filter_30d" : "filter_all")}
              </button>
            ))}
          </div>
        </div>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="px-4 py-2 text-start font-medium">{t("due_date")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("supplier_name")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("invoice_date")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("note")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("remaining")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {schedule.map((r) => (
                <tr key={r.invoice.id} className="cursor-pointer hover:bg-background" onClick={() => setSelectedId(r.supplier_id)}>
                  <td className="px-4 py-2.5 font-medium">{r.due_date}</td>
                  <td className="px-4 py-2.5">{supplierName(r.supplier_id)}</td>
                  <td className="px-4 py-2.5 text-muted">{r.invoice.inv_date}</td>
                  <td className="px-4 py-2.5 text-muted">{r.invoice.note}</td>
                  <td className="px-4 py-2.5 text-end font-semibold">{fmtMoney(r.remaining, lang)}</td>
                  <td className="px-4 py-2.5 text-end"><DueBadge row={r} t={t} lang={lang} /></td>
                </tr>
              ))}
              {schedule.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-muted">{t("no_due_invoices")}</td></tr>
              )}
            </tbody>
            {schedule.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-background font-bold">
                  <td className="px-4 py-2.5" colSpan={4}>{t("to_pay")}</td>
                  <td className="px-4 py-2.5 text-end">{fmtMoney(scheduleTotal, lang)}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Recherche + filtre */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("search")}
          className="w-56 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          {t("show_inactive")}
        </label>
      </div>

      {/* Formulaire ajout / édition */}
      {formOpen && (
        <div className="card mb-4 p-4">
          <div className="mb-3 font-semibold">{editingId ? t("edit_supplier") : t("new_supplier")}</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input className="input" placeholder={t("supplier_name")} value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="input" placeholder={t("contact_name")} value={form.contact_name}
              onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
            <input className="input" placeholder={t("phone")} value={form.phone} dir="ltr"
              onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <input className="input" placeholder={t("email")} value={form.email} dir="ltr"
              onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <label className="flex flex-col gap-1 text-xs text-muted">
              {t("payment_terms")}
              <input className="input" type="number" min={0} step={1} value={form.payment_terms_days}
                onChange={(e) => setForm({ ...form, payment_terms_days: e.target.value })} />
            </label>
            <div className="hidden sm:block" />
            <input className="input sm:col-span-2" placeholder={t("address")} value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })} />
            <textarea className="input sm:col-span-2" rows={2} placeholder={t("note")} value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              {t("active")}
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={saveSupplier} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg">
              {t("save")}
            </button>
            <button onClick={() => { setFormOpen(false); setEditingId(null); }} className="rounded-lg border border-border px-4 py-2 text-sm">
              {t("cancel")}
            </button>
          </div>
        </div>
      )}

      {/* Grille des fournisseurs */}
      {visibleSuppliers.length === 0 ? (
        <div className="card p-8 text-center text-muted">{t("no_suppliers")}</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibleSuppliers.map((s) => {
            const tot = totals.get(s.id) ?? { ordered: 0, paid: 0, due: 0 };
            return (
              <div key={s.id} className="card flex flex-col p-4">
                <div className="mb-1 flex items-start justify-between gap-2">
                  <button onClick={() => setSelectedId(s.id)} className="text-start font-semibold hover:text-primary">
                    {s.name}
                  </button>
                  {!s.active && (
                    <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-muted">{t("inactive")}</span>
                  )}
                </div>
                {(overdueBySupplier.get(s.id) ?? 0) > 0 && (
                  <div className="mb-1 self-start rounded bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
                    {t("due_overdue")}: {fmtMoney(overdueBySupplier.get(s.id) ?? 0, lang)}
                  </div>
                )}
                {(s.contact_name || s.phone) && (
                  <div className="mb-2 text-xs text-muted">
                    {s.contact_name}{s.contact_name && s.phone ? " · " : ""}<span dir="ltr">{s.phone}</span>
                  </div>
                )}
                <div className="mt-auto flex items-center justify-between border-t border-border pt-2 text-xs text-muted">
                  <span>{t("ordered")}: {fmtMoney(tot.ordered, lang)}</span>
                  <span>{t("paid")}: {fmtMoney(tot.paid, lang)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-sm">{t("to_pay")}</span>
                  <span className={`font-bold ${tot.due > 0 ? "text-danger" : "text-success"}`}>{fmtMoney(tot.due, lang)}</span>
                </div>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => setSelectedId(s.id)} className="flex-1 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20">
                    {t("account_statement")}
                  </button>
                  <button onClick={() => openEdit(s)} className="rounded-lg border border-border px-3 py-1.5 text-xs">{t("edit")}</button>
                  <button onClick={() => deleteSupplier(s)} className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-danger">✕</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Fiche fournisseur + relevé de compte
// ============================================================
function SupplierDetail({
  supplier, invoices, payments, totals, allocated, onBack, onEdit, onChanged, supabase, t, lang,
}: {
  supplier: Supplier;
  invoices: SupplierInvoice[];
  payments: SupplierPayment[];
  totals: { ordered: number; paid: number; due: number };
  allocated: OpenInvoice[];
  onBack: () => void;
  onEdit: () => void;
  onChanged: () => void | Promise<void>;
  supabase: ReturnType<typeof createClient>;
  t: (k: string) => string;
  lang: "fr" | "ar";
}) {
  const terms = supplier.payment_terms_days ?? 0;
  const [mForm, setMForm] = useState<{ kind: MovementKind; date: string; due: string; amount: string; note: string }>({
    kind: "invoice", date: today(), due: addDays(today(), terms), amount: "", note: "",
  });
  const byInvoice = useMemo(() => new Map(allocated.map((r) => [r.invoice.id, r])), [allocated]);
  const overdue = allocated.filter((r) => r.status === "overdue").reduce((s, r) => s + r.remaining, 0);

  async function updateDueDate(invoiceId: string, due: string) {
    await supabase.from("supplier_invoices").update({ due_date: due || null }).eq("id", invoiceId);
    await onChanged();
  }

  // Relevé : mouvements fusionnés, du plus ancien au plus récent, avec solde progressif
  const movements = useMemo<Movement[]>(() => {
    const rows: Movement[] = [
      ...invoices.map((i) => ({ id: i.id, kind: "invoice" as const, date: i.inv_date, amount: Number(i.amount), note: i.note })),
      ...payments.map((p) => ({ id: p.id, kind: "payment" as const, date: p.pay_date, amount: Number(p.amount), note: p.note })),
    ];
    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind === "invoice" ? -1 : 1));
    return rows;
  }, [invoices, payments]);

  const withBalance = useMemo(() => {
    let bal = 0;
    return movements.map((m) => {
      bal += m.kind === "invoice" ? m.amount : -m.amount;
      return { ...m, balance: bal };
    });
  }, [movements]);

  async function addMovement() {
    const amount = parseFloat(mForm.amount);
    if (!amount) return;
    if (mForm.kind === "invoice") {
      await supabase.from("supplier_invoices").insert({
        supplier_id: supplier.id, inv_date: mForm.date, due_date: mForm.due || null, amount, note: mForm.note || null,
      });
    } else {
      await supabase.from("supplier_payments").insert({
        supplier_id: supplier.id, pay_date: mForm.date, amount, note: mForm.note || null,
      });
    }
    setMForm((f) => ({ ...f, amount: "", note: "" }));
    await onChanged();
  }

  async function deleteMovement(m: Movement) {
    if (!confirm(t("confirm_delete"))) return;
    const table = m.kind === "invoice" ? "supplier_invoices" : "supplier_payments";
    await supabase.from(table).delete().eq("id", m.id);
    await onChanged();
  }

  function exportCsv() {
    const header = [t("date"), t("movement"), t("due_date"), t("debit"), t("credit"), t("running_balance"), t("note")];
    const lines = withBalance.map((m) => [
      m.date,
      m.kind === "invoice" ? t("type_invoice") : t("type_payment"),
      byInvoice.get(m.id)?.due_date ?? "",
      m.kind === "invoice" ? m.amount : "",
      m.kind === "payment" ? m.amount : "",
      m.balance,
      (m.note ?? "").replace(/"/g, '""'),
    ]);
    const csv = [header, ...lines]
      .map((r) => r.map((c) => `"${String(c)}"`).join(","))
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `releve_${supplier.name.replace(/\s+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const phoneDigits = (supplier.phone ?? "").replace(/[^\d+]/g, "");
  const waNumber = phoneDigits.replace(/^\+/, "").replace(/^0/, "212"); // Maroc

  return (
    <div>
      <button onClick={onBack} className="no-print mb-3 text-sm text-primary hover:underline">{t("back_to_suppliers")}</button>

      {/* En-tête fiche */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{supplier.name}</h1>
          {!supplier.active && <span className="text-sm text-muted">{t("inactive")}</span>}
        </div>
        <div className="no-print flex flex-wrap gap-2">
          {phoneDigits && (
            <>
              <a href={`tel:${phoneDigits}`} className="rounded-lg border border-border px-3 py-2 text-sm">📞 {t("call")}</a>
              <a href={`https://wa.me/${waNumber}`} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-border px-3 py-2 text-sm">💬 {t("whatsapp")}</a>
            </>
          )}
          {supplier.email && (
            <a href={`mailto:${supplier.email}`} className="rounded-lg border border-border px-3 py-2 text-sm">✉️ {t("send_email")}</a>
          )}
          <button onClick={onEdit} className="rounded-lg border border-border px-3 py-2 text-sm">{t("edit")}</button>
        </div>
      </div>

      {/* Coordonnées */}
      {(supplier.contact_name || supplier.phone || supplier.email || supplier.address || supplier.notes) && (
        <div className="card mb-4 grid gap-x-6 gap-y-1 p-4 text-sm sm:grid-cols-2">
          {supplier.contact_name && <div><span className="text-muted">{t("contact_name")}: </span>{supplier.contact_name}</div>}
          {supplier.phone && <div><span className="text-muted">{t("phone")}: </span><span dir="ltr">{supplier.phone}</span></div>}
          {supplier.email && <div><span className="text-muted">{t("email")}: </span><span dir="ltr">{supplier.email}</span></div>}
          {supplier.address && <div><span className="text-muted">{t("address")}: </span>{supplier.address}</div>}
          {supplier.notes && <div className="sm:col-span-2"><span className="text-muted">{t("note")}: </span>{supplier.notes}</div>}
        </div>
      )}

      {/* KPI */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card p-3">
          <div className="text-xs text-muted">{t("ordered")}</div>
          <div className="text-lg font-bold">{fmtMoney(totals.ordered, lang)}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">{t("paid")}</div>
          <div className="text-lg font-bold">{fmtMoney(totals.paid, lang)}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">{t("to_pay")}</div>
          <div className={`text-lg font-bold ${totals.due > 0 ? "text-danger" : "text-success"}`}>{fmtMoney(totals.due, lang)}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">{t("overdue_total")}</div>
          <div className={`text-lg font-bold ${overdue > 0 ? "text-danger" : ""}`}>{fmtMoney(overdue, lang)}</div>
        </div>
      </div>
      <p className="mb-4 text-xs text-muted">
        {t("payment_terms_short")}: {terms > 0 ? fmtDays(terms, lang) : t("terms_cash")}
      </p>

      {/* Nouveau mouvement */}
      <div className="card no-print mb-4 grid gap-2 p-4 sm:grid-cols-3 xl:grid-cols-6">
        <select className="input" value={mForm.kind} onChange={(e) => setMForm({ ...mForm, kind: e.target.value as MovementKind })}>
          <option value="invoice">{t("type_invoice")}</option>
          <option value="payment">{t("type_payment")}</option>
        </select>
        <input className="input" type="date" title={t("date")} value={mForm.date}
          onChange={(e) => setMForm({ ...mForm, date: e.target.value, due: e.target.value ? addDays(e.target.value, terms) : "" })} />
        {mForm.kind === "invoice" ? (
          <label className="flex flex-col text-[11px] text-muted">
            {t("due_date")}
            <input className="input" type="date" value={mForm.due} onChange={(e) => setMForm({ ...mForm, due: e.target.value })} />
          </label>
        ) : (
          <div className="hidden sm:block" />
        )}
        <input className="input" type="number" placeholder={t("amount")} value={mForm.amount} onChange={(e) => setMForm({ ...mForm, amount: e.target.value })} />
        <input className="input" placeholder={t("note")} value={mForm.note} onChange={(e) => setMForm({ ...mForm, note: e.target.value })} />
        <button onClick={addMovement} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg">+ {t("add")}</button>
      </div>

      {/* Relevé de compte */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold">{t("account_statement")}</h2>
          <p className="no-print text-xs text-muted">{t("statement_hint")}</p>
        </div>
        <div className="no-print flex gap-2">
          <button onClick={exportCsv} className="rounded-lg border border-border px-3 py-1.5 text-xs">{t("export_csv")}</button>
          <button onClick={() => window.print()} className="rounded-lg border border-border px-3 py-1.5 text-xs">{t("print_statement")}</button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border text-muted">
              <th className="px-4 py-2 text-start font-medium">{t("date")}</th>
              <th className="px-4 py-2 text-start font-medium">{t("movement")}</th>
              <th className="px-4 py-2 text-start font-medium">{t("note")}</th>
              <th className="px-4 py-2 text-start font-medium">{t("due_date")}</th>
              <th className="px-4 py-2 text-end font-medium">{t("debit")}</th>
              <th className="px-4 py-2 text-end font-medium">{t("credit")}</th>
              <th className="px-4 py-2 text-end font-medium">{t("running_balance")}</th>
              <th className="no-print px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {withBalance.map((m) => (
              <tr key={`${m.kind}-${m.id}`}>
                <td className="px-4 py-2.5">{m.date}</td>
                <td className="px-4 py-2.5">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${m.kind === "invoice" ? "bg-danger/10 text-danger" : "bg-success/10 text-success"}`}>
                    {m.kind === "invoice" ? t("type_invoice") : t("type_payment")}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-muted">{m.note}</td>
                <td className="px-4 py-2.5">
                  {m.kind === "invoice" && byInvoice.get(m.id) ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="date"
                        className="no-print rounded border border-border bg-surface px-1.5 py-0.5 text-xs"
                        defaultValue={byInvoice.get(m.id)!.due_date}
                        onBlur={(e) => {
                          if (e.target.value && e.target.value !== byInvoice.get(m.id)!.due_date) updateDueDate(m.id, e.target.value);
                        }}
                      />
                      <span className="print-area hidden">{byInvoice.get(m.id)!.due_date}</span>
                      <DueBadge row={byInvoice.get(m.id)!} t={t} lang={lang} />
                    </div>
                  ) : "—"}
                </td>
                <td className="px-4 py-2.5 text-end">{m.kind === "invoice" ? fmtMoney(m.amount, lang) : "—"}</td>
                <td className="px-4 py-2.5 text-end">{m.kind === "payment" ? fmtMoney(m.amount, lang) : "—"}</td>
                <td className={`px-4 py-2.5 text-end font-semibold ${m.balance > 0 ? "text-danger" : "text-success"}`}>{fmtMoney(m.balance, lang)}</td>
                <td className="no-print px-4 py-2.5 text-end">
                  <button onClick={() => deleteMovement(m)} className="text-danger hover:underline">✕</button>
                </td>
              </tr>
            ))}
            {withBalance.length === 0 && (
              <tr><td colSpan={8} className="p-6 text-center text-muted">{t("no_movements")}</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-background font-bold">
              <td className="px-4 py-2.5" colSpan={4}>{t("to_pay")}</td>
              <td className="px-4 py-2.5 text-end">{fmtMoney(totals.ordered, lang)}</td>
              <td className="px-4 py-2.5 text-end">{fmtMoney(totals.paid, lang)}</td>
              <td className={`px-4 py-2.5 text-end ${totals.due > 0 ? "text-danger" : "text-success"}`}>{fmtMoney(totals.due, lang)}</td>
              <td className="no-print"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// Pastille de statut d'échéance (en retard / bientôt dû / à venir / payé)
function DueBadge({ row, t, lang }: { row: OpenInvoice; t: (k: string) => string; lang: "fr" | "ar" }) {
  const cls =
    row.status === "overdue" ? "bg-danger/10 text-danger"
    : row.status === "due_soon" ? "bg-accent/10 text-accent"
    : row.status === "paid" ? "bg-success/10 text-success"
    : "bg-background text-muted";
  const label =
    row.status === "paid" ? t("due_paid")
    : row.days === 0 ? t("due_today")
    : row.days < 0 ? t("days_late").replace("{d}", fmtDays(row.days, lang))
    : t("days_left").replace("{d}", fmtDays(row.days, lang));
  return <span className={`whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}
