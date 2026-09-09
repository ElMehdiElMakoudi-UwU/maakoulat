"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { fmtNum } from "@/lib/format";
import type { Client } from "@/lib/types";

const emptyForm = {
  name: "",
  ice: "",
  if_num: "",
  rc: "",
  address: "",
  phone: "",
  email: "",
  contact_name: "",
  notes: "",
  wants_invoice: true,
  discount_rate: "",
  active: true,
};
type ClientForm = typeof emptyForm;

export default function ClientsPage() {
  const { t, lang } = useI18n();
  const supabase = useMemo(() => createClient(), []);

  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ClientForm>(emptyForm);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("clients").select("*").order("sort_order");
    setClients((data as Client[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients
      .filter((c) => (showInactive ? true : c.active))
      .filter((c) => {
        if (!q) return true;
        return (
          c.name.toLowerCase().includes(q) ||
          (c.ice ?? "").toLowerCase().includes(q) ||
          (c.contact_name ?? "").toLowerCase().includes(q) ||
          (c.phone ?? "").toLowerCase().includes(q)
        );
      });
  }, [clients, search, showInactive]);

  const nbInvoiced = useMemo(
    () => clients.filter((c) => c.active && c.wants_invoice).length,
    [clients]
  );

  function openAdd() {
    setForm(emptyForm);
    setEditingId(null);
    setFormOpen(true);
  }
  function openEdit(c: Client) {
    setForm({
      name: c.name,
      ice: c.ice ?? "",
      if_num: c.if_num ?? "",
      rc: c.rc ?? "",
      address: c.address ?? "",
      phone: c.phone ?? "",
      email: c.email ?? "",
      contact_name: c.contact_name ?? "",
      notes: c.notes ?? "",
      wants_invoice: c.wants_invoice,
      discount_rate: c.discount_rate ? String(c.discount_rate) : "",
      active: c.active,
    });
    setEditingId(c.id);
    setFormOpen(true);
  }

  async function save() {
    if (!form.name.trim()) return;
    const payload = {
      name: form.name.trim(),
      ice: form.ice.trim() || null,
      if_num: form.if_num.trim() || null,
      rc: form.rc.trim() || null,
      address: form.address.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      contact_name: form.contact_name.trim() || null,
      notes: form.notes.trim() || null,
      wants_invoice: form.wants_invoice,
      discount_rate: parseFloat(form.discount_rate) || 0,
      active: form.active,
    };
    if (editingId) {
      await supabase.from("clients").update(payload).eq("id", editingId);
    } else {
      const maxOrder = clients.reduce((m, c) => Math.max(m, c.sort_order), 0);
      await supabase.from("clients").insert({ ...payload, sort_order: maxOrder + 1 });
    }
    setFormOpen(false);
    setEditingId(null);
    await load();
  }

  async function remove(c: Client) {
    if (!confirm(t("confirm_delete_client"))) return;
    await supabase.from("clients").delete().eq("id", c.id);
    await load();
  }

  async function toggleField(c: Client, field: "wants_invoice" | "active") {
    const patch = { [field]: !c[field] };
    setClients((old) => old.map((x) => (x.id === c.id ? { ...x, ...patch } : x)));
    await supabase.from("clients").update(patch).eq("id", c.id);
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("clients_title")}</h1>
          <p className="max-w-xl text-sm text-muted">{t("clients_hint")}</p>
        </div>
        <button
          onClick={openAdd}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg hover:opacity-90"
        >
          + {t("add_client")}
        </button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="card p-3">
          <div className="text-xs text-muted">{t("client_count")}</div>
          <div className="text-xl font-bold">{fmtNum(clients.filter((c) => c.active).length, lang)}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">{t("invoiced_clients")}</div>
          <div className="text-xl font-bold text-primary">{fmtNum(nbInvoiced, lang)}</div>
        </div>
      </div>

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

      {formOpen && (
        <div className="card mb-4 p-4">
          <div className="mb-3 font-semibold">{editingId ? t("edit_client") : t("new_client")}</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input className="input sm:col-span-2" placeholder={t("client_name")} value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="input" placeholder={t("client_ice")} value={form.ice} dir="ltr"
              onChange={(e) => setForm({ ...form, ice: e.target.value })} />
            <input className="input" placeholder={t("client_if")} value={form.if_num} dir="ltr"
              onChange={(e) => setForm({ ...form, if_num: e.target.value })} />
            <input className="input" placeholder={t("client_rc")} value={form.rc} dir="ltr"
              onChange={(e) => setForm({ ...form, rc: e.target.value })} />
            <input className="input" placeholder={t("contact_name")} value={form.contact_name}
              onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
            <input className="input" placeholder={t("phone")} value={form.phone} dir="ltr"
              onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <input className="input" placeholder={t("email")} value={form.email} dir="ltr"
              onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <input className="input sm:col-span-2" placeholder={t("address")} value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })} />
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted">{t("discount_rate")}</span>
              <input type="number" className="input w-24" value={form.discount_rate} dir="ltr"
                onChange={(e) => setForm({ ...form, discount_rate: e.target.value })} />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.wants_invoice}
                onChange={(e) => setForm({ ...form, wants_invoice: e.target.checked })} />
              {t("wants_invoice")}
            </label>
            <textarea className="input sm:col-span-2" rows={2} placeholder={t("note")} value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              {t("active")}
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={save} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg">
              {t("save")}
            </button>
            <button onClick={() => { setFormOpen(false); setEditingId(null); }}
              className="rounded-lg border border-border px-4 py-2 text-sm">
              {t("cancel")}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="p-8 text-center text-muted">{t("loading")}</p>
      ) : visible.length === 0 ? (
        <div className="card p-8 text-center text-muted">{t("no_clients")}</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="px-3 py-2 text-start font-medium">{t("client_name")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("client_ice")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("phone")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("discount_rate")}</th>
                <th className="px-3 py-2 text-center font-medium">{t("wants_invoice")}</th>
                <th className="px-3 py-2 text-center font-medium">{t("actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((c) => (
                <tr key={c.id} className={c.active ? "" : "opacity-40"}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{c.name}</div>
                    {c.contact_name && <div className="text-xs text-muted">{c.contact_name}</div>}
                  </td>
                  <td className="px-3 py-2" dir="ltr">{c.ice ?? "—"}</td>
                  <td className="px-3 py-2" dir="ltr">{c.phone ?? "—"}</td>
                  <td className="px-3 py-2 text-end">{c.discount_rate ? `${fmtNum(c.discount_rate, lang)} %` : "—"}</td>
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => toggleField(c, "wants_invoice")}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        c.wants_invoice ? "bg-primary/10 text-primary" : "bg-background text-muted"
                      }`}
                    >
                      {c.wants_invoice ? t("yes_short") : t("no_short")}
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-center">
                    <button onClick={() => toggleField(c, "active")} title="on/off" className="me-3 text-muted hover:text-foreground">
                      {c.active ? "🟢" : "⚪"}
                    </button>
                    <button onClick={() => openEdit(c)} className="me-3 text-xs hover:underline">{t("edit")}</button>
                    <button onClick={() => remove(c)} className="text-danger hover:underline">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
