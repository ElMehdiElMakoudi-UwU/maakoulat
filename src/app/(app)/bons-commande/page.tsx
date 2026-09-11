"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { fmtMoney, today } from "@/lib/format";
import { COMPANY } from "@/lib/company";
import { buildBcPdf, pdfToBase64, fetchLogoDataUrl } from "@/lib/bcPdf";
import type { PurchaseOrder, PurchaseOrderItem, Product, Supplier, OrderStatus } from "@/lib/types";

/** Ligne éditable dans l'éditeur (sans id lié à la DB tant que non enregistré). */
type EditLine = { unit: string; designation: string; quantity: string; unit_price: string };

const emptyLine = (): EditLine => ({ unit: "", designation: "", quantity: "", unit_price: "" });

export default function BonsCommandePage() {
  const { t, lang } = useI18n();
  const supabase = useMemo(() => createClient(), []);

  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [items, setItems] = useState<PurchaseOrderItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  // null = vue liste ; sinon on édite ce bon (id vide = création).
  const [editId, setEditId] = useState<string | null>(null);
  const [header, setHeader] = useState({
    bc_number: "",
    supplier_id: "",
    order_date: today(),
    vat_rate: "20",
    status: "draft" as OrderStatus,
    note: "",
  });
  const [lines, setLines] = useState<EditLine[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [sending, setSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  async function loadAll() {
    setLoading(true);
    const [oRes, iRes, sRes, pRes] = await Promise.all([
      supabase.from("purchase_orders").select("*").order("order_date", { ascending: false }),
      supabase.from("purchase_order_items").select("*").order("sort_order"),
      supabase.from("suppliers").select("*").order("sort_order"),
      supabase.from("products").select("*").eq("active", true).order("name"),
    ]);
    setOrders((oRes.data as PurchaseOrder[]) ?? []);
    setItems((iRes.data as PurchaseOrderItem[]) ?? []);
    setSuppliers((sRes.data as Supplier[]) ?? []);
    setProducts((pRes.data as Product[]) ?? []);
    setLoading(false);
  }
  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const supName = (id: string | null) =>
    (id && suppliers.find((s) => s.id === id)?.name) || t("no_supplier");

  const itemsOf = (orderId: string) => items.filter((i) => i.order_id === orderId);
  const totalHTOf = (orderId: string) =>
    itemsOf(orderId).reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0);

  // ---- Calculs de l'éditeur ----
  const vatRate = parseFloat(header.vat_rate) || 0;
  const editTotalHT = lines.reduce(
    (s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.unit_price) || 0),
    0
  );
  const editVAT = editTotalHT * (vatRate / 100);
  const editTTC = editTotalHT + editVAT;

  // ---- Ouverture / création ----
  function openNew() {
    setEditId("");
    setHeader({ bc_number: "", supplier_id: "", order_date: today(), vat_rate: "20", status: "draft", note: "" });
    setLines([emptyLine()]);
    setSaved(false);
  }
  function openEdit(o: PurchaseOrder) {
    setEditId(o.id);
    setHeader({
      bc_number: o.bc_number ?? "",
      supplier_id: o.supplier_id ?? "",
      order_date: o.order_date,
      vat_rate: String(o.vat_rate),
      status: o.status,
      note: o.note ?? "",
    });
    const ls = itemsOf(o.id).map((i) => ({
      unit: i.unit ?? "",
      designation: i.designation,
      quantity: String(i.quantity),
      unit_price: String(i.unit_price),
    }));
    setLines(ls.length ? ls : [emptyLine()]);
    setSaved(false);
  }
  async function duplicate(o: PurchaseOrder) {
    openEdit(o);
    setEditId("");
    setHeader((h) => ({ ...h, bc_number: "", order_date: today(), status: "draft" }));
  }

  // ---- Édition des lignes ----
  function updateLine(idx: number, patch: Partial<EditLine>) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function onDesignationChange(idx: number, value: string) {
    // Auto-remplissage depuis le catalogue du fournisseur si la désignation correspond.
    const match = supplierProducts.find(
      (p) => p.name === value || p.name_fr === value
    );
    setLines((ls) =>
      ls.map((l, i) => {
        if (i !== idx) return l;
        const next = { ...l, designation: value };
        if (match) {
          if (!l.unit && match.unit) next.unit = match.unit;
          if (!l.unit_price || parseFloat(l.unit_price) === 0)
            next.unit_price = String(match.purchase_price);
        }
        return next;
      })
    );
  }
  function addLine() {
    setLines((ls) => [...ls, emptyLine()]);
  }
  function removeLine(idx: number) {
    setLines((ls) => (ls.length === 1 ? [emptyLine()] : ls.filter((_, i) => i !== idx)));
  }

  // Change de fournisseur : on vide les lignes (les produits diffèrent d'un fournisseur à l'autre).
  function onSupplierChange(supplierId: string) {
    const hasEntries = lines.some((l) => l.designation.trim());
    if (hasEntries && supplierId !== header.supplier_id && !confirm(t("change_supplier_warn"))) return;
    setHeader((h) => ({ ...h, supplier_id: supplierId }));
    if (supplierId !== header.supplier_id) setLines([emptyLine()]);
  }

  // ---- Enregistrement (cœur réutilisé par « Enregistrer » et « Envoyer ») ----
  async function persist(): Promise<string | null> {
    const payload = {
      bc_number: header.bc_number.trim() || null,
      supplier_id: header.supplier_id || null,
      order_date: header.order_date,
      vat_rate: parseFloat(header.vat_rate) || 0,
      status: header.status,
      note: header.note.trim() || null,
    };

    let orderId = editId;
    if (orderId) {
      await supabase.from("purchase_orders").update(payload).eq("id", orderId);
      await supabase.from("purchase_order_items").delete().eq("order_id", orderId);
    } else {
      const { data } = await supabase.from("purchase_orders").insert(payload).select("id").single();
      orderId = (data as { id: string } | null)?.id ?? null;
    }

    if (orderId) {
      const rows = lines
        .filter((l) => l.designation.trim())
        .map((l, i) => ({
          order_id: orderId,
          unit: l.unit.trim() || null,
          designation: l.designation.trim(),
          quantity: parseFloat(l.quantity) || 0,
          unit_price: parseFloat(l.unit_price) || 0,
          sort_order: i,
        }));
      if (rows.length) await supabase.from("purchase_order_items").insert(rows);
    }
    return orderId;
  }

  async function save() {
    if (!header.supplier_id) {
      alert(t("supplier_required"));
      return;
    }
    setSaving(true);
    const orderId = await persist();
    await loadAll();
    setSaving(false);
    if (orderId) {
      setSaved(true);
      setEditId(orderId);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  // ---- Envoi du bon de commande par email (PDF joint, via Gmail côté serveur) ----
  async function sendEmail() {
    if (!header.supplier_id) {
      alert(t("supplier_required"));
      return;
    }
    const supplier = suppliers.find((s) => s.id === header.supplier_id);
    const to = supplier?.email?.trim();
    if (!to) {
      alert(t("no_supplier_email"));
      return;
    }
    const validLines = lines.filter((l) => l.designation.trim());
    if (validLines.length === 0) {
      alert(t("no_data"));
      return;
    }
    if (!confirm(`${t("confirm_send_prefix")} ${to} ?`)) return;

    setSending(true);
    try {
      // On enregistre d'abord pour garder la base à jour.
      const orderId = await persist();
      if (orderId) setEditId(orderId);

      const logo = await fetchLogoDataUrl();
      const doc = buildBcPdf(
        {
          bcNumber: header.bc_number.trim(),
          orderDate: header.order_date,
          supplierName: supplier?.name ?? "",
          lines: validLines.map((l) => ({
            unit: l.unit,
            designation: l.designation,
            quantity: parseFloat(l.quantity) || 0,
            unitPrice: parseFloat(l.unit_price) || 0,
          })),
          totalHT: editTotalHT,
          vatRate,
          vatAmount: editVAT,
          totalTTC: editTTC,
        },
        logo
      );
      const pdfBase64 = pdfToBase64(doc);
      const bcTag = header.bc_number.trim() ? `-${header.bc_number.trim()}` : "";
      const filename = `BC${bcTag}.pdf`;
      const subject = `${t("order")}${header.bc_number.trim() ? ` N° ${header.bc_number.trim()}` : ""} — ${COMPANY.name}`;
      const text =
        `Bonjour,\n\nVeuillez trouver ci-joint notre bon de commande` +
        `${header.bc_number.trim() ? ` N° ${header.bc_number.trim()}` : ""} du ${header.order_date}.\n\n` +
        `Cordialement,\n${COMPANY.name}\nTél : ${COMPANY.tel}`;

      const res = await fetch("/api/send-bc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject, text, pdfBase64, filename }),
      });

      if (res.ok) {
        await loadAll();
        setEmailSent(true);
        setTimeout(() => setEmailSent(false), 3000);
      } else {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        alert(err.error === "not_configured" ? t("email_not_configured") : t("email_error"));
      }
    } catch {
      alert(t("email_error"));
    } finally {
      setSending(false);
    }
  }

  async function removeOrder(id: string) {
    if (!confirm(t("confirm_delete_order"))) return;
    await supabase.from("purchase_orders").delete().eq("id", id);
    if (editId === id) setEditId(null);
    loadAll();
  }

  const statusLabel = (s: OrderStatus) =>
    s === "sent" ? t("status_sent") : s === "received" ? t("status_received") : t("status_draft");

  // Produits liés au fournisseur sélectionné (seuls ceux-ci sont proposés dans les lignes).
  const supplierProducts = useMemo(
    () => (header.supplier_id ? products.filter((p) => p.supplier_id === header.supplier_id) : []),
    [products, header.supplier_id]
  );

  // datalist de désignations (catalogue du fournisseur)
  const productLabels = useMemo(() => {
    const set = new Set<string>();
    for (const p of supplierProducts) {
      const label = p.name_fr || p.name;
      if (label) set.add(label);
    }
    return Array.from(set);
  }, [supplierProducts]);

  if (loading) return <p className="p-8 text-center text-muted">{t("loading")}</p>;

  // =================== VUE LISTE ===================
  if (editId === null) {
    return (
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">{t("orders_title")}</h1>
          <button onClick={openNew} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg">
            + {t("new_order")}
          </button>
        </div>

        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="px-4 py-2 text-start font-medium">{t("bc_number")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("order_date")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("supplier")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("status")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("total_ttc")}</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {orders.map((o) => {
                const ht = totalHTOf(o.id);
                const ttc = ht * (1 + Number(o.vat_rate) / 100);
                return (
                  <tr key={o.id} className="cursor-pointer hover:bg-background" onClick={() => openEdit(o)}>
                    <td className="px-4 py-2.5 font-semibold">{o.bc_number || "—"}</td>
                    <td className="px-4 py-2.5">{o.order_date}</td>
                    <td className="px-4 py-2.5">{supName(o.supplier_id)}</td>
                    <td className="px-4 py-2.5">
                      <span className="rounded-full bg-background px-2 py-0.5 text-xs">{statusLabel(o.status)}</span>
                    </td>
                    <td className="px-4 py-2.5 text-end font-semibold">{fmtMoney(ttc, lang)}</td>
                    <td className="px-4 py-2.5 text-end whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => duplicate(o)} className="mx-1 text-muted hover:underline" title={t("duplicate")}>⧉</button>
                      <button onClick={() => removeOrder(o.id)} className="mx-1 text-danger hover:underline">✕</button>
                    </td>
                  </tr>
                );
              })}
              {orders.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-muted">{t("empty_orders")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // =================== VUE ÉDITEUR ===================
  return (
    <div>
      {/* Barre d'actions (masquée à l'impression) */}
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => { setEditId(null); loadAll(); }} className="text-sm text-muted hover:underline">
          {t("back_to_list")}
        </button>
        <div className="flex items-center gap-2">
          {saved && <span className="text-sm font-medium text-success">{t("order_saved")}</span>}
          {emailSent && <span className="text-sm font-medium text-success">{t("email_sent")}</span>}
          <button onClick={() => window.print()} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold">
            🖨️ {t("print_order")}
          </button>
          <button onClick={sendEmail} disabled={sending || saving || !header.supplier_id}
            className="rounded-lg border border-primary bg-surface px-4 py-2 text-sm font-semibold text-primary disabled:opacity-60">
            {sending ? t("sending_email") : `✉️ ${t("send_email_btn")}`}
          </button>
          <button onClick={save} disabled={saving || sending || !header.supplier_id}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg disabled:opacity-60">
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      </div>

      {/* En-tête éditable */}
      <div className="no-print card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1 block text-muted">{t("bc_number")}</span>
          <input className="input" value={header.bc_number} placeholder="33-24"
            onChange={(e) => setHeader({ ...header, bc_number: e.target.value })} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">{t("order_date")}</span>
          <input className="input" type="date" value={header.order_date}
            onChange={(e) => setHeader({ ...header, order_date: e.target.value })} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">{t("supplier")} *</span>
          <select className={`input ${header.supplier_id ? "" : "border-danger"}`} value={header.supplier_id}
            onChange={(e) => onSupplierChange(e.target.value)}>
            <option value="">{t("select_supplier")}</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-muted">{t("vat")}</span>
            <input className="input" type="number" value={header.vat_rate}
              onChange={(e) => setHeader({ ...header, vat_rate: e.target.value })} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted">{t("status")}</span>
            <select className="input" value={header.status}
              onChange={(e) => setHeader({ ...header, status: e.target.value as OrderStatus })}>
              <option value="draft">{t("status_draft")}</option>
              <option value="sent">{t("status_sent")}</option>
              <option value="received">{t("status_received")}</option>
            </select>
          </label>
        </div>
      </div>

      <datalist id="product-list">
        {productLabels.map((l) => <option key={l} value={l} />)}
      </datalist>

      {/* Document (visible à l'écran ET à l'impression) */}
      <div className="print-area card p-5">
        {/* En-tête document (identique au modèle Excel : nom société + logo) */}
        <div className="mb-4 flex items-center justify-between gap-4 border-b-2 border-primary pb-3">
          <div className="text-lg font-bold tracking-wide text-primary">{COMPANY.name}</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-maakoulat.jpeg" alt="Maakoulatcom" className="h-16 w-auto" />
        </div>

        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold">
              {t("order")} {header.bc_number ? `N° ${header.bc_number}` : ""}
            </h2>
            <p className="text-sm text-muted">{header.order_date}</p>
          </div>
          <div className="text-end text-sm">
            <div className="text-muted">{t("supplier")}</div>
            <div className="font-semibold">{supName(header.supplier_id)}</div>
            <div className="mt-1 text-muted">{statusLabel(header.status)}</div>
          </div>
        </div>

        {/* Tableau des lignes */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="px-2 py-2 text-start font-medium">{t("unit")}</th>
                <th className="px-2 py-2 text-start font-medium">{t("designation")}</th>
                <th className="px-2 py-2 text-end font-medium">{t("quantity")}</th>
                <th className="px-2 py-2 text-end font-medium">{t("unit_price_ht")}</th>
                <th className="px-2 py-2 text-end font-medium">{t("line_total_ht")}</th>
                <th className="no-print px-2 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((l, idx) => {
                const lt = (parseFloat(l.quantity) || 0) * (parseFloat(l.unit_price) || 0);
                return (
                  <tr key={idx}>
                    <td className="px-2 py-1.5">
                      <input className="input print:border-0 print:bg-transparent print:px-0" value={l.unit}
                        disabled={!header.supplier_id}
                        onChange={(e) => updateLine(idx, { unit: e.target.value })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input className="input print:border-0 print:bg-transparent print:px-0" list="product-list"
                        disabled={!header.supplier_id}
                        placeholder={header.supplier_id ? t("pick_product") : t("select_supplier_first")} value={l.designation}
                        onChange={(e) => onDesignationChange(idx, e.target.value)} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input className="input text-end print:border-0 print:bg-transparent print:px-0" type="number" value={l.quantity}
                        disabled={!header.supplier_id}
                        onChange={(e) => updateLine(idx, { quantity: e.target.value })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input className="input text-end print:border-0 print:bg-transparent print:px-0" type="number" value={l.unit_price}
                        disabled={!header.supplier_id}
                        onChange={(e) => updateLine(idx, { unit_price: e.target.value })} />
                    </td>
                    <td className="px-2 py-1.5 text-end font-semibold whitespace-nowrap">{fmtMoney(lt, lang)}</td>
                    <td className="no-print px-2 py-1.5 text-end">
                      <button onClick={() => removeLine(idx)} className="text-danger hover:underline">✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {header.supplier_id && supplierProducts.length === 0 && (
          <p className="no-print mt-2 text-sm text-danger">{t("no_products_supplier")}</p>
        )}
        <button onClick={addLine} disabled={!header.supplier_id}
          className="no-print mt-3 text-sm font-medium text-primary hover:underline disabled:opacity-50 disabled:no-underline">
          {t("add_line")}
        </button>

        {/* Totaux */}
        <div className="mt-5 flex justify-end">
          <div className="w-full max-w-xs space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">{t("total_ht")}</span>
              <span className="font-semibold">{fmtMoney(editTotalHT, lang)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">{t("vat_amount")} {vatRate}%</span>
              <span className="font-semibold">{fmtMoney(editVAT, lang)}</span>
            </div>
            <div className="flex justify-between border-t border-border pt-1.5 text-base">
              <span className="font-bold">{t("total_ttc")}</span>
              <span className="font-bold text-primary">{fmtMoney(editTTC, lang)}</span>
            </div>
          </div>
        </div>

        {header.note && <p className="mt-4 text-sm text-muted">{header.note}</p>}

        {/* Pied de page (identique au modèle Excel) */}
        <div className="mt-6 border-t border-border pt-3 text-center text-[11px] leading-relaxed text-muted">
          Adresse : {COMPANY.address} · Tél : {COMPANY.tel} · Email : {COMPANY.email}
          <br />
          RC : {COMPANY.rc} · Patente : {COMPANY.patente} · IF : {COMPANY.if} · ICE : {COMPANY.ice}
        </div>
      </div>
    </div>
  );
}
