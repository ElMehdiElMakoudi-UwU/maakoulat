"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { currentMonth, fmtMoney, fmtNum, monthLabel, monthRange } from "@/lib/format";
import { COMPANY } from "@/lib/company";
import { generateInvoices, invoiceTotals, type PoolLine } from "@/lib/ventilation";
import type { Client, SalesInvoice, SalesInvoiceItem } from "@/lib/types";

function InvoiceDoc({
  invoice,
  items,
  onBack,
  t,
  lang,
}: {
  invoice: SalesInvoice;
  items: SalesInvoiceItem[];
  onBack: () => void;
  t: (k: string) => string;
  lang: "fr" | "ar";
}) {
  const lines = items.map((it) => ({
    quantity: Number(it.quantity),
    unit_price: Number(it.unit_price),
    vat_rate: Number(it.vat_rate),
  }));
  const tot = invoiceTotals(lines);

  // ventilation TVA par taux
  const byRate = new Map<number, { base: number; tva: number }>();
  for (const l of lines) {
    const base = l.quantity * l.unit_price;
    const cur = byRate.get(l.vat_rate) ?? { base: 0, tva: 0 };
    cur.base += base;
    cur.tva += base * (l.vat_rate / 100);
    byRate.set(l.vat_rate, cur);
  }

  return (
    <div>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <button onClick={onBack} className="rounded-lg border border-border px-4 py-2 text-sm">
          {t("back_to_list")}
        </button>
        <button
          onClick={() => window.print()}
          className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold"
        >
          🖨️ {t("print_pdf")}
        </button>
      </div>

      <div className="print-area card p-5">
        <div className="mb-4 flex items-center justify-between gap-4 border-b-2 border-primary pb-3">
          <div className="text-lg font-bold tracking-wide text-primary">{COMPANY.name}</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-maakoulat.jpeg" alt="Maakoulatcom" className="h-16 w-auto" />
        </div>

        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">
              {invoice.inv_number
                ? `${t("invoices_title")} N° ${invoice.inv_number}`
                : `${t("invoices_title")} — ${t("inv_status_draft")}`}
            </h2>
            <p className="text-sm text-muted">{invoice.inv_date}</p>
          </div>
          <div className="text-end text-sm">
            <div className="text-muted">{t("inv_client")}</div>
            <div className="font-semibold">{invoice.client_name}</div>
            {invoice.client_address && <div className="text-muted">{invoice.client_address}</div>}
            {invoice.client_ice && <div className="text-muted">ICE {invoice.client_ice}</div>}
            {invoice.client_if && <div className="text-muted">IF {invoice.client_if}</div>}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="px-2 py-2 text-start font-medium">{t("unit")}</th>
                <th className="px-2 py-2 text-start font-medium">{t("designation")}</th>
                <th className="px-2 py-2 text-end font-medium">{t("quantity")}</th>
                <th className="px-2 py-2 text-end font-medium">{t("unit_price_ht")}</th>
                <th className="px-2 py-2 text-end font-medium">{t("vat")}</th>
                <th className="px-2 py-2 text-end font-medium">{t("line_total_ht")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((l) => (
                <tr key={l.id}>
                  <td className="px-2 py-1.5">{l.unit}</td>
                  <td className="px-2 py-1.5" dir="auto">
                    {l.designation}
                  </td>
                  <td className="px-2 py-1.5 text-end">{fmtNum(Number(l.quantity), lang)}</td>
                  <td className="px-2 py-1.5 text-end">{fmtMoney(Number(l.unit_price), lang)}</td>
                  <td className="px-2 py-1.5 text-end">{Number(l.vat_rate)}%</td>
                  <td className="px-2 py-1.5 text-end">
                    {fmtMoney(Number(l.quantity) * Number(l.unit_price), lang)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex justify-end">
          <div className="w-full max-w-xs space-y-1 text-sm">
            {[...byRate.entries()]
              .sort((a, b) => a[0] - b[0])
              .map(([rate, v]) => (
                <div key={rate} className="flex justify-between text-muted">
                  <span>
                    {t("total_ht")} {rate}%
                  </span>
                  <span>{fmtMoney(v.base, lang)}</span>
                </div>
              ))}
            <div className="flex justify-between border-t border-border pt-1">
              <span>{t("total_ht")}</span>
              <span className="font-semibold">{fmtMoney(tot.ht, lang)}</span>
            </div>
            <div className="flex justify-between">
              <span>{t("vat_amount")}</span>
              <span className="font-semibold">{fmtMoney(tot.tva, lang)}</span>
            </div>
            <div className="flex justify-between border-t-2 border-primary pt-1 text-base font-bold text-primary">
              <span>{t("total_ttc")}</span>
              <span>{fmtMoney(tot.ttc, lang)}</span>
            </div>
          </div>
        </div>

        <div className="mt-6 border-t border-border pt-3 text-center text-[11px] text-muted">
          <div>
            {COMPANY.address} · {t("phone")} : {COMPANY.tel} · {COMPANY.email}
          </div>
          <div>
            RC : {COMPANY.rc} · Patente : {COMPANY.patente} · IF : {COMPANY.if} · ICE : {COMPANY.ice}
          </div>
        </div>
      </div>
    </div>
  );
}

interface SaleRow {
  product_id: string;
  quantity: number;
  sale_price: number;
  products:
    | { name: string; name_fr: string | null; vat_rate: number; unit: string | null }
    | { name: string; name_fr: string | null; vat_rate: number; unit: string | null }[]
    | null;
}

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m, 0).getDate();
  return `${month}-${String(d).padStart(2, "0")}`;
}

export default function FacturesPage() {
  const { t, lang } = useI18n();
  const supabase = useMemo(() => createClient(), []);

  const [month, setMonth] = useState(currentMonth());
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const [clients, setClients] = useState<Client[]>([]);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [encaissement, setEncaissement] = useState(0);
  const [targets, setTargets] = useState<{ client_id: string; target_ttc: number }[]>([]);
  const [ventRow, setVentRow] = useState(false);

  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [items, setItems] = useState<SalesInvoiceItem[]>([]);
  const [startNumber, setStartNumber] = useState("120");

  const [editId, setEditId] = useState<string | null>(null);
  const [draftItems, setDraftItems] = useState<SalesInvoiceItem[]>([]);
  const [viewId, setViewId] = useState<string | null>(null);

  const showFlash = (m: string) => {
    setFlash(m);
    setTimeout(() => setFlash(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    const { start, end } = monthRange(month);
    const [cliRes, salesRes, ventRes, tgtRes, invRes, setRes] = await Promise.all([
      supabase.from("clients").select("*").order("sort_order"),
      supabase
        .from("sales")
        .select("product_id, quantity, sale_price, products(name, name_fr, vat_rate, unit)")
        .gte("sale_date", start)
        .lt("sale_date", end),
      supabase.from("monthly_ventilation").select("*").eq("month", month).maybeSingle(),
      supabase.from("ventilation_targets").select("*").eq("month", month),
      supabase.from("sales_invoices").select("*").eq("month", month).order("created_at"),
      supabase.from("app_settings").select("value").eq("key", "invoice_start_number").maybeSingle(),
    ]);

    setClients((cliRes.data as Client[]) ?? []);
    setSales((salesRes.data as SaleRow[]) ?? []);
    const vent = ventRes.data as { encaissement_total: number } | null;
    setVentRow(!!ventRes.data);
    setEncaissement(vent ? Number(vent.encaissement_total) : 0);
    setTargets(
      ((tgtRes.data as { client_id: string; target_ttc: number }[]) ?? []).map((r) => ({
        client_id: r.client_id,
        target_ttc: Number(r.target_ttc),
      }))
    );
    const inv = (invRes.data as SalesInvoice[]) ?? [];
    setInvoices(inv);
    if (inv.length) {
      const { data: it } = await supabase
        .from("sales_invoice_items")
        .select("*")
        .in(
          "invoice_id",
          inv.map((x) => x.id)
        )
        .order("sort_order");
      setItems((it as SalesInvoiceItem[]) ?? []);
    } else setItems([]);
    setStartNumber(((setRes.data as { value: string } | null)?.value ?? "120") as string);
    setLoading(false);
  }, [supabase, month]);

  useEffect(() => {
    load();
  }, [load]);

  // ---------- Pool ----------
  const pool = useMemo<PoolLine[]>(() => {
    const map = new Map<string, PoolLine & { _ht: number }>();
    for (const s of sales) {
      const p = Array.isArray(s.products) ? s.products[0] : s.products;
      const qty = Number(s.quantity) || 0;
      const price = Number(s.sale_price) || 0;
      const vat = Number(p?.vat_rate) || 0;
      const cur =
        map.get(s.product_id) ??
        {
          product_id: s.product_id,
          name: p?.name_fr || p?.name || "—",
          unit: p?.unit ?? null,
          vat,
          pu: 0,
          qty: 0,
          _ht: 0,
        };
      cur.qty += qty;
      cur._ht += qty * price;
      map.set(s.product_id, cur);
    }
    return Array.from(map.values())
      .map(({ _ht, ...l }) => ({ ...l, pu: l.qty ? _ht / l.qty : 0 }))
      .sort((a, b) => b.pu * b.qty - a.pu * a.qty);
  }, [sales]);

  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);

  const itemsByInvoice = useMemo(() => {
    const m = new Map<string, SalesInvoiceItem[]>();
    for (const it of items) {
      const arr = m.get(it.invoice_id) ?? [];
      arr.push(it);
      m.set(it.invoice_id, arr);
    }
    return m;
  }, [items]);

  const invTTC = (id: string) => invoiceTotals(itemsByInvoice.get(id) ?? []).ttc;

  // ---------- Contrôle mensuel (quantités) ----------
  const control = useMemo(() => {
    const invoicedQty = new Map<string, number>();
    for (const it of items)
      if (it.product_id) invoicedQty.set(it.product_id, (invoicedQty.get(it.product_id) ?? 0) + Number(it.quantity));
    const rows = pool.map((l) => {
      const inv = invoicedQty.get(l.product_id) ?? 0;
      const left = l.qty - inv;
      return { ...l, inv, comptant: Math.max(0, left), over: left < -1e-6 };
    });
    const sumInvTTC = invoices.reduce((s, x) => s + invTTC(x.id), 0);
    const comptantTTC = rows.reduce((s, r) => s + r.comptant * r.pu * (1 + r.vat / 100), 0);
    return { rows, sumInvTTC, comptantTTC };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, items, invoices]);

  const hasVentilation = ventRow && (encaissement > 0 || targets.some((x) => x.target_ttc > 0));

  // ---------- Génération ----------
  async function generate() {
    if (invoices.length && !confirm(t("inv_confirm_regen"))) return;
    setGenerating(true);
    try {
      if (invoices.length) await supabase.from("sales_invoices").delete().eq("month", month);

      const genTargets = targets
        .filter((x) => x.target_ttc > 0)
        .map((x) => ({
          client_id: x.client_id,
          target_ttc: x.target_ttc,
          discount_rate: Number(clientById.get(x.client_id)?.discount_rate ?? 0),
        }));

      const { invoices: gen } = generateInvoices(pool, genTargets);
      const invDate = lastDayOfMonth(month);

      for (const g of gen) {
        const c = clientById.get(g.client_id);
        const { data: inserted, error } = await supabase
          .from("sales_invoices")
          .insert({
            month,
            client_id: g.client_id,
            client_name: c?.name ?? null,
            client_ice: c?.ice ?? null,
            client_if: c?.if_num ?? null,
            client_address: c?.address ?? null,
            inv_date: invDate,
            target_ttc: g.target_ttc,
            discount_rate: g.discount_rate,
            status: "draft",
          })
          .select()
          .single();
        if (error || !inserted) throw error;
        if (g.lines.length) {
          const rows = g.lines.map((l, i) => ({
            invoice_id: (inserted as SalesInvoice).id,
            product_id: l.product_id,
            designation: l.designation,
            unit: l.unit,
            quantity: l.quantity,
            unit_price: l.unit_price,
            vat_rate: l.vat_rate,
            sort_order: i,
          }));
          const { error: e2 } = await supabase.from("sales_invoice_items").insert(rows);
          if (e2) throw e2;
        }
      }
      showFlash(t("saved"));
      await load();
    } catch (e) {
      console.error(e);
      showFlash(t("bank_parse_failed"));
    } finally {
      setGenerating(false);
    }
  }

  async function finalizeAll() {
    const drafts = invoices.filter((x) => x.status === "draft").sort((a, b) => (a.created_at! < b.created_at! ? -1 : 1));
    if (!drafts.length || !confirm(t("inv_confirm_finalize"))) return;
    const { data: maxRow } = await supabase
      .from("sales_invoices")
      .select("inv_number")
      .not("inv_number", "is", null)
      .order("inv_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    const maxExisting = (maxRow as { inv_number: number } | null)?.inv_number ?? 0;
    let n = Math.max(parseInt(startNumber, 10) || 1, maxExisting + 1);
    for (const d of drafts) {
      await supabase.from("sales_invoices").update({ inv_number: n, status: "final" }).eq("id", d.id);
      n++;
    }
    await supabase
      .from("app_settings")
      .upsert({ key: "invoice_start_number", value: String(n) }, { onConflict: "key" });
    showFlash(t("saved"));
    await load();
  }

  async function deleteInvoice(id: string) {
    if (!confirm(t("inv_delete"))) return;
    await supabase.from("sales_invoices").delete().eq("id", id);
    if (editId === id) setEditId(null);
    await load();
  }

  // ---------- Éditeur de lignes ----------
  function openEditor(inv: SalesInvoice) {
    setEditId(inv.id);
    setDraftItems((itemsByInvoice.get(inv.id) ?? []).map((x) => ({ ...x })));
  }
  const availFor = useCallback(
    (productId: string) => {
      const poolQty = pool.find((p) => p.product_id === productId)?.qty ?? 0;
      const usedElsewhere = items
        .filter((it) => it.product_id === productId && it.invoice_id !== editId)
        .reduce((s, it) => s + Number(it.quantity), 0);
      const inDraft = draftItems
        .filter((it) => it.product_id === productId)
        .reduce((s, it) => s + Number(it.quantity), 0);
      return { max: poolQty - usedElsewhere, inDraft };
    },
    [pool, items, draftItems, editId]
  );

  async function saveLines() {
    if (!editId) return;
    await supabase.from("sales_invoice_items").delete().eq("invoice_id", editId);
    const rows = draftItems
      .filter((l) => Number(l.quantity) > 0)
      .map((l, i) => ({
        invoice_id: editId,
        product_id: l.product_id,
        designation: l.designation,
        unit: l.unit,
        quantity: Number(l.quantity),
        unit_price: Number(l.unit_price),
        vat_rate: Number(l.vat_rate),
        sort_order: i,
      }));
    if (rows.length) await supabase.from("sales_invoice_items").insert(rows);
    setEditId(null);
    showFlash(t("saved"));
    await load();
  }

  const draftTotals = invoiceTotals(draftItems.map((d) => ({ quantity: Number(d.quantity), unit_price: Number(d.unit_price), vat_rate: Number(d.vat_rate) })));
  const editingInv = invoices.find((x) => x.id === editId) ?? null;

  // ---------- Document imprimable ----------
  const viewInv = invoices.find((x) => x.id === viewId) ?? null;
  if (viewInv) {
    return (
      <InvoiceDoc
        invoice={viewInv}
        items={itemsByInvoice.get(viewInv.id) ?? []}
        onBack={() => setViewId(null)}
        t={t}
        lang={lang}
      />
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("invoices_title")}</h1>
          <p className="max-w-xl text-sm text-muted">{t("invoices_hint")}</p>
        </div>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2 outline-none focus:border-primary"
        />
      </div>

      {flash && (
        <div className="mb-4 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm text-primary">
          {flash}
        </div>
      )}

      {loading ? (
        <p className="p-8 text-center text-muted">{t("loading")}</p>
      ) : (
        <>
          <p className="mb-3 text-sm capitalize text-muted">{monthLabel(month, lang)}</p>

          {!hasVentilation ? (
            <div className="card p-6 text-center text-muted">{t("inv_need_ventilation")}</div>
          ) : (
            <>
              {/* ---------- Barre d'action ---------- */}
              <div className="card mb-4 flex flex-wrap items-center gap-3 p-4">
                <button
                  onClick={generate}
                  disabled={generating}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg disabled:opacity-50"
                >
                  {generating
                    ? t("inv_generating")
                    : invoices.length
                      ? t("inv_regenerate")
                      : t("inv_generate")}
                </button>
                {invoices.some((x) => x.status === "draft") && (
                  <button
                    onClick={finalizeAll}
                    className="rounded-lg border border-border px-4 py-2 text-sm font-medium"
                  >
                    {t("inv_finalize_all")}
                  </button>
                )}
                <label className="ms-auto flex items-center gap-2 text-sm text-muted">
                  {t("inv_start_number")}
                  <input
                    type="number"
                    value={startNumber}
                    dir="ltr"
                    onChange={(e) => setStartNumber(e.target.value)}
                    onBlur={() =>
                      supabase
                        .from("app_settings")
                        .upsert(
                          { key: "invoice_start_number", value: startNumber },
                          { onConflict: "key" }
                        )
                    }
                    className="input w-24"
                  />
                </label>
              </div>

              {invoices.length > 0 && (
                <p className="mb-3 text-xs text-accent">{t("inv_regen_hint")}</p>
              )}

              {/* ---------- Liste des factures ---------- */}
              {invoices.length === 0 ? (
                <div className="card p-6 text-center text-muted">{t("inv_none")}</div>
              ) : (
                <div className="card mb-5 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-muted">
                        <th className="px-3 py-2 text-start font-medium">{t("inv_number")}</th>
                        <th className="px-3 py-2 text-start font-medium">{t("inv_client")}</th>
                        <th className="px-3 py-2 text-end font-medium">{t("inv_target")}</th>
                        <th className="px-3 py-2 text-end font-medium">{t("inv_realized")}</th>
                        <th className="px-3 py-2 text-end font-medium">{t("inv_gap")}</th>
                        <th className="px-3 py-2 text-start font-medium">{t("status")}</th>
                        <th className="px-3 py-2 text-center font-medium">{t("actions")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {invoices.map((inv) => {
                        const real = invTTC(inv.id);
                        const gap = real - Number(inv.target_ttc);
                        return (
                          <tr key={inv.id}>
                            <td className="px-3 py-2 font-medium">{inv.inv_number ?? "—"}</td>
                            <td className="px-3 py-2">{inv.client_name}</td>
                            <td className="px-3 py-2 text-end">{fmtMoney(Number(inv.target_ttc), lang)}</td>
                            <td className="px-3 py-2 text-end font-medium">{fmtMoney(real, lang)}</td>
                            <td
                              className={`px-3 py-2 text-end ${Math.abs(gap) < 1 ? "text-muted" : "text-accent"}`}
                            >
                              {fmtMoney(gap, lang)}
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                  inv.status === "final"
                                    ? "bg-success/15 text-success"
                                    : "bg-accent/15 text-accent"
                                }`}
                              >
                                {inv.status === "final" ? t("inv_status_final") : t("inv_status_draft")}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-center">
                              <button onClick={() => openEditor(inv)} className="me-2 text-xs hover:underline">
                                {t("inv_edit_lines")}
                              </button>
                              <button onClick={() => setViewId(inv.id)} className="me-2 text-xs hover:underline">
                                {t("inv_view")}
                              </button>
                              <button
                                onClick={() => deleteInvoice(inv.id)}
                                className="text-xs text-danger hover:underline"
                              >
                                ✕
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ---------- Éditeur de lignes ---------- */}
              {editingInv && (
                <div className="card mb-5 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h2 className="font-bold">
                      {t("inv_edit_lines")} — {editingInv.client_name}
                    </h2>
                    <span className="text-sm text-muted">
                      {t("inv_target")} {fmtMoney(Number(editingInv.target_ttc), lang)}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-muted">
                          <th className="px-2 py-1.5 text-start font-medium">{t("designation")}</th>
                          <th className="px-2 py-1.5 text-end font-medium">{t("quantity")}</th>
                          <th className="px-2 py-1.5 text-end font-medium">{t("unit_price_ht")}</th>
                          <th className="px-2 py-1.5 text-end font-medium">{t("vat")}</th>
                          <th className="px-2 py-1.5 text-end font-medium">{t("line_total_ht")}</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {draftItems.map((l, idx) => {
                          const av = l.product_id ? availFor(l.product_id) : { max: Infinity, inDraft: 0 };
                          const over = Number(l.quantity) > av.max + 1e-6;
                          return (
                            <tr key={idx}>
                              <td className="px-2 py-1.5">{l.designation}</td>
                              <td className="px-2 py-1.5 text-end">
                                <input
                                  type="number"
                                  value={l.quantity}
                                  dir="ltr"
                                  onChange={(e) =>
                                    setDraftItems((d) =>
                                      d.map((x, i) =>
                                        i === idx ? { ...x, quantity: parseFloat(e.target.value) || 0 } : x
                                      )
                                    )
                                  }
                                  className={`w-20 rounded border bg-transparent px-1 py-0.5 text-end ${
                                    over ? "border-danger" : "border-border"
                                  }`}
                                />
                                {l.product_id && (
                                  <div className="text-[10px] text-muted">
                                    {t("inv_available")} {fmtNum(av.max, lang)}
                                  </div>
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-end">
                                <input
                                  type="number"
                                  value={l.unit_price}
                                  dir="ltr"
                                  onChange={(e) =>
                                    setDraftItems((d) =>
                                      d.map((x, i) =>
                                        i === idx ? { ...x, unit_price: parseFloat(e.target.value) || 0 } : x
                                      )
                                    )
                                  }
                                  className="w-24 rounded border border-border bg-transparent px-1 py-0.5 text-end"
                                />
                              </td>
                              <td className="px-2 py-1.5 text-end">{Number(l.vat_rate)}%</td>
                              <td className="px-2 py-1.5 text-end">
                                {fmtMoney(Number(l.quantity) * Number(l.unit_price), lang)}
                              </td>
                              <td className="px-2 py-1.5 text-end">
                                <button
                                  onClick={() => setDraftItems((d) => d.filter((_, i) => i !== idx))}
                                  className="text-danger"
                                >
                                  ✕
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* ajouter une ligne depuis le pool */}
                  <div className="mt-2">
                    <select
                      value=""
                      onChange={(e) => {
                        const p = pool.find((x) => x.product_id === e.target.value);
                        if (!p) return;
                        setDraftItems((d) => [
                          ...d,
                          {
                            id: `new-${Date.now()}`,
                            invoice_id: editId!,
                            product_id: p.product_id,
                            designation: p.name,
                            unit: p.unit,
                            quantity: 0,
                            unit_price: Math.round(p.pu * 100) / 100,
                            vat_rate: p.vat,
                            sort_order: d.length,
                          },
                        ]);
                      }}
                      className="input max-w-xs"
                    >
                      <option value="">{t("inv_add_line")}…</option>
                      {pool
                        .filter((p) => !draftItems.some((d) => d.product_id === p.product_id))
                        .map((p) => (
                          <option key={p.product_id} value={p.product_id}>
                            {p.name} ({t("inv_available")} {fmtNum(availFor(p.product_id).max, lang)})
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                    <div className="text-sm">
                      <span className="text-muted">{t("total_ht")} </span>
                      <span className="font-semibold">{fmtMoney(draftTotals.ht, lang)}</span>
                      <span className="text-muted"> · {t("vat_amount")} </span>
                      <span className="font-semibold">{fmtMoney(draftTotals.tva, lang)}</span>
                      <span className="text-muted"> · {t("total_ttc")} </span>
                      <span className="font-bold">{fmtMoney(draftTotals.ttc, lang)}</span>
                      <span
                        className={`ms-2 ${Math.abs(draftTotals.ttc - Number(editingInv.target_ttc)) < 1 ? "text-muted" : "text-accent"}`}
                      >
                        ({fmtMoney(draftTotals.ttc - Number(editingInv.target_ttc), lang)})
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={saveLines}
                        disabled={draftItems.some(
                          (l) => l.product_id && Number(l.quantity) > availFor(l.product_id).max + 1e-6
                        )}
                        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg disabled:opacity-50"
                      >
                        {t("inv_save_lines")}
                      </button>
                      <button
                        onClick={() => setEditId(null)}
                        className="rounded-lg border border-border px-4 py-2 text-sm"
                      >
                        {t("cancel")}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ---------- Contrôle mensuel ---------- */}
              {invoices.length > 0 && (
                <div>
                  <h2 className="mb-2 font-bold">{t("inv_control")}</h2>
                  <div className="card overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-muted">
                          <th className="px-3 py-2 text-start font-medium">{t("product")}</th>
                          <th className="px-3 py-2 text-end font-medium">{t("inv_col_pool")}</th>
                          <th className="px-3 py-2 text-end font-medium">{t("inv_col_invoiced")}</th>
                          <th className="px-3 py-2 text-end font-medium">{t("inv_col_comptant")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {control.rows.map((r) => (
                          <tr key={r.product_id} className={r.over ? "bg-danger/10" : ""}>
                            <td className="px-3 py-1.5">{r.name}</td>
                            <td className="px-3 py-1.5 text-end">{fmtNum(r.qty, lang)}</td>
                            <td className="px-3 py-1.5 text-end">{fmtNum(r.inv, lang)}</td>
                            <td className={`px-3 py-1.5 text-end ${r.over ? "font-bold text-danger" : ""}`}>
                              {r.over ? fmtNum(r.qty - r.inv, lang) : fmtNum(r.comptant, lang)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-border bg-background text-sm font-semibold">
                          <td className="px-3 py-2">{t("inv_check_row")}</td>
                          <td className="px-3 py-2 text-end" colSpan={3}>
                            {fmtMoney(control.sumInvTTC + control.comptantTTC, lang)}
                            <span className="text-muted"> / {fmtMoney(encaissement, lang)}</span>
                          </td>
                        </tr>
                        <tr className="text-xs text-muted">
                          <td className="px-3 py-1.5">
                            {t("inv_totttc")} {fmtMoney(control.sumInvTTC, lang)}
                          </td>
                          <td className="px-3 py-1.5 text-end" colSpan={3}>
                            {t("inv_comptant")} {fmtMoney(control.comptantTTC, lang)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
