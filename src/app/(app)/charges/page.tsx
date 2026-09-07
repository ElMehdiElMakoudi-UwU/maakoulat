"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { currentMonth, fmtMoney, monthLabel } from "@/lib/format";
import type { Charge } from "@/lib/types";

export default function ChargesPage() {
  const { t, lang } = useI18n();
  const supabase = useMemo(() => createClient(), []);
  const [month, setMonth] = useState(currentMonth());
  const [charges, setCharges] = useState<Charge[]>([]);
  const [loading, setLoading] = useState(true);
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
    setLoading(false);
  }
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const total = charges.filter((c) => c.active).reduce((s, c) => s + Number(c.amount), 0);

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
                <td className="px-4 py-2.5 text-end">{fmtMoney(total, lang)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
