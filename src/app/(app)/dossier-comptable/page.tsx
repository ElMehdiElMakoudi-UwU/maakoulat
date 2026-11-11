"use client";

// =====================================================================
// Dossier comptable mensuel (mois N-1), en 3 étapes :
//  1. Achats : chèques fournisseurs du relevé → registre des factures d'achat (TVA par facture)
//  2. Ventes : versements / virements du relevé → registre des factures de vente,
//     taux 20 % / 0 % choisi pour équilibrer TVA collectée ≈ TVA déductible
//  3. Factures : lignes générées depuis les ventes réelles du mois, n°, impression
// =====================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { currentMonth, fmtMoney, fmtNum, monthLabel, monthRange } from "@/lib/format";
import { fetchAll } from "@/lib/demandData";
import { buildXlsx, type Cell } from "@/lib/xlsx";
import { downloadFile } from "@/lib/csv";
import { VAT_RATES } from "@/lib/tva";
import type { PoolLine } from "@/lib/ventilation";
import InvoiceDoc from "@/components/InvoiceDoc";
import {
  balanceRates, chequeNumberFromLabel, fillInvoice, isSupplierDebit, linesTTC, normCheque,
  previousMonth, round2, saleModeFromLabel, splitTTC,
} from "@/lib/compta";
import type { BankTransaction, Client, SalesInvoice, SalesInvoiceItem, Supplier, SupplierCheque } from "@/lib/types";

interface PurchaseInvoice {
  id: string;
  month: string;
  inv_date: string;
  supplier_id: string | null;
  supplier_name: string | null;
  ref: string | null;
  amount_ttc: number;
  vat_rate: number;
  payment_mode: string;
  cheque_number: string | null;
  due_date: string | null;
  bank_transaction_id: string | null;
  note: string | null;
  sort_order: number;
}

type DossierInvoice = SalesInvoice & {
  vat_rate: number | null;
  payment_mode: string | null;
  bank_transaction_id: string | null;
  source: string | null;
};

interface SaleRow {
  product_id: string;
  quantity: number;
  sale_price: number;
  products:
    | { name: string; name_fr: string | null; vat_rate: number; unit: string | null }
    | { name: string; name_fr: string | null; vat_rate: number; unit: string | null }[]
    | null;
}

const PURCHASE_MODES = ["cheque", "virement", "espece", "effet", "prelevement"] as const;
const SALE_MODES = ["espece", "virement", "cheque", "autre"] as const;

const fmtD = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");

export default function DossierComptablePage() {
  const { t, lang } = useI18n();
  const supabase = useMemo(() => createClient(), []);

  const [month, setMonth] = useState(previousMonth(currentMonth()));
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [cheques, setCheques] = useState<SupplierCheque[]>([]);
  const [txs, setTxs] = useState<BankTransaction[]>([]);
  const [purchases, setPurchases] = useState<PurchaseInvoice[]>([]);
  const [invoices, setInvoices] = useState<DossierInvoice[]>([]);
  const [items, setItems] = useState<SalesInvoiceItem[]>([]);
  const [finalOtherItems, setFinalOtherItems] = useState<SalesInvoiceItem[]>([]);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [startNumber, setStartNumber] = useState("120");
  const [locked, setLocked] = useState<Set<string>>(new Set());

  const [viewId, setViewId] = useState<string | null>(null);
  const [printAll, setPrintAll] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [draftItems, setDraftItems] = useState<SalesInvoiceItem[]>([]);
  const [addProduct, setAddProduct] = useState("");

  const showFlash = (m: string) => {
    setFlash(m);
    setTimeout(() => setFlash(null), 4000);
  };

  // ---------------------------------------------------------------- chargement
  const load = useCallback(async () => {
    setLoading(true);
    const { start, end } = monthRange(month);
    const [supRes, cliRes, chqRes, txRes, pRes, invRes, setRes] = await Promise.all([
      supabase.from("suppliers").select("*").order("sort_order"),
      supabase.from("clients").select("*").order("sort_order"),
      supabase.from("supplier_cheques").select("*"),
      supabase.from("bank_transactions").select("*").gte("op_date", start).lt("op_date", end).order("op_date"),
      supabase.from("purchase_invoices").select("*").eq("month", month).order("inv_date").order("sort_order"),
      supabase.from("sales_invoices").select("*").eq("month", month).order("inv_date").order("created_at"),
      supabase.from("app_settings").select("value").eq("key", "invoice_start_number").maybeSingle(),
    ]);
    let saleRows: SaleRow[] = [];
    try {
      saleRows = await fetchAll<SaleRow>((a, b) =>
        supabase
          .from("sales")
          .select("product_id, quantity, sale_price, products(name, name_fr, vat_rate, unit)")
          .gte("sale_date", start)
          .lt("sale_date", end)
          .order("id")
          .range(a, b)
      );
    } catch (e) {
      console.error(e);
    }

    setMigrationMissing(!!pRes.error);
    setSuppliers((supRes.data as Supplier[]) ?? []);
    setClients((cliRes.data as Client[]) ?? []);
    setCheques((chqRes.data as SupplierCheque[]) ?? []);
    setTxs((txRes.data as BankTransaction[]) ?? []);
    setPurchases((pRes.data as PurchaseInvoice[]) ?? []);
    setSales(saleRows);
    setStartNumber((setRes.data as { value: string } | null)?.value ?? "120");

    const allInv = (invRes.data as DossierInvoice[]) ?? [];
    const dossier = allInv.filter((x) => x.source === "dossier");
    const others = allInv.filter((x) => x.source !== "dossier" && x.status === "final");
    setInvoices(dossier);
    const ids = allInv.map((x) => x.id);
    if (ids.length) {
      const { data } = await supabase.from("sales_invoice_items").select("*").in("invoice_id", ids).order("sort_order");
      const its = (data as SalesInvoiceItem[]) ?? [];
      const dIds = new Set(dossier.map((x) => x.id));
      const oIds = new Set(others.map((x) => x.id));
      setItems(its.filter((i) => dIds.has(i.invoice_id)));
      setFinalOtherItems(its.filter((i) => oIds.has(i.invoice_id)));
    } else {
      setItems([]);
      setFinalOtherItems([]);
    }
    setLoading(false);
  }, [supabase, month]);

  useEffect(() => {
    load();
    setLocked(new Set());
    setEditId(null);
    setViewId(null);
  }, [load]);

  // ---------------------------------------------------------------- dérivés
  const supById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);
  const cliById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const debits = useMemo(() => txs.filter((x) => x.direction === "debit"), [txs]);
  const credits = useMemo(() => txs.filter((x) => x.direction === "credit"), [txs]);
  const usedTxP = useMemo(() => new Set(purchases.map((p) => p.bank_transaction_id).filter(Boolean)), [purchases]);
  const usedTxS = useMemo(() => new Set(invoices.map((p) => p.bank_transaction_id).filter(Boolean)), [invoices]);
  const debitsLeft = debits.filter((d) => !usedTxP.has(d.id));
  const creditsLeft = credits.filter((d) => !usedTxS.has(d.id));

  const pTot = useMemo(() => {
    const byRate = new Map<number, { ht: number; vat: number; ttc: number }>();
    for (const p of purchases) {
      const r = Number(p.vat_rate);
      const { ht, vat } = splitTTC(Number(p.amount_ttc), r);
      const cur = byRate.get(r) ?? { ht: 0, vat: 0, ttc: 0 };
      cur.ht += ht;
      cur.vat += vat;
      cur.ttc += Number(p.amount_ttc);
      byRate.set(r, cur);
    }
    const all = [...byRate.values()].reduce((a, b) => ({ ht: a.ht + b.ht, vat: a.vat + b.vat, ttc: a.ttc + b.ttc }), { ht: 0, vat: 0, ttc: 0 });
    return { byRate: [...byRate.entries()].sort((a, b) => b[0] - a[0]), ...all };
  }, [purchases]);
  const deductible = round2(pTot.vat);

  const invRate = (x: DossierInvoice) => Number(x.vat_rate ?? 20);
  const sTot = useMemo(() => {
    let ttc = 0;
    let vat = 0;
    const byRate = new Map<number, number>();
    for (const x of invoices) {
      const r = invRate(x);
      ttc += Number(x.target_ttc);
      vat += splitTTC(Number(x.target_ttc), r).vat;
      byRate.set(r, (byRate.get(r) ?? 0) + Number(x.target_ttc));
    }
    return { ttc, vat: round2(vat), byRate };
  }, [invoices]);
  const vatDue = round2(sTot.vat - deductible);
  const credited = credits.reduce((s, x) => s + Math.abs(Number(x.amount)), 0);

  // pool = ventes réelles du mois (moins ce qui est déjà sur des factures finalisées hors dossier)
  const pool = useMemo<PoolLine[]>(() => {
    const map = new Map<string, PoolLine & { _ht: number }>();
    for (const s of sales) {
      const p = Array.isArray(s.products) ? s.products[0] : s.products;
      const qty = Number(s.quantity) || 0;
      const cur = map.get(s.product_id) ?? {
        product_id: s.product_id,
        name: p?.name_fr || p?.name || "—",
        unit: p?.unit ?? null,
        vat: Number(p?.vat_rate) || 0,
        pu: 0,
        qty: 0,
        _ht: 0,
      };
      cur.qty += qty;
      cur._ht += qty * (Number(s.sale_price) || 0);
      map.set(s.product_id, cur);
    }
    const used = new Map<string, number>();
    for (const it of finalOtherItems)
      if (it.product_id) used.set(it.product_id, (used.get(it.product_id) ?? 0) + Number(it.quantity));
    return [...map.values()]
      .map(({ _ht, ...l }) => ({
        ...l,
        pu: l.qty > 0 ? _ht / l.qty : 0, // PU HT moyen pondéré
        qty: Math.max(0, l.qty - (used.get(l.product_id) ?? 0)),
      }))
      .sort((a, b) => b.pu * b.qty - a.pu * a.qty);
  }, [sales, finalOtherItems]);

  // capacité TTC des ventes réelles par taux
  const capByRate = useMemo(() => {
    const m = new Map<number, number>();
    for (const l of pool) m.set(l.vat, (m.get(l.vat) ?? 0) + l.qty * l.pu * (1 + l.vat / 100));
    return m;
  }, [pool]);

  const itemsByInv = useMemo(() => {
    const m = new Map<string, SalesInvoiceItem[]>();
    for (const it of items) m.set(it.invoice_id, [...(m.get(it.invoice_id) ?? []), it]);
    return m;
  }, [items]);
  const invReal = (id: string) =>
    linesTTC((itemsByInv.get(id) ?? []).map((i) => ({ quantity: Number(i.quantity), unit_price: Number(i.unit_price), vat_rate: Number(i.vat_rate) })));

  // n° provisoires (ordre de date) pour les brouillons
  const provisional = useMemo(() => {
    const maxFinal = invoices.reduce((m, x) => Math.max(m, x.inv_number ?? 0), 0);
    let n = Math.max(parseInt(startNumber, 10) || 1, maxFinal + 1);
    const out = new Map<string, number>();
    for (const x of invoices) if (!x.inv_number) out.set(x.id, n++);
    return out;
  }, [invoices, startNumber]);
  const numberOf = (x: DossierInvoice) => x.inv_number ?? provisional.get(x.id) ?? 0;

  // ---------------------------------------------------------------- étape 1 : achats
  function purchaseFromTx(d: BankTransaction, sortBase: number) {
    const no = chequeNumberFromLabel(d.label);
    const amt = Math.abs(Number(d.amount));
    const chq =
      (no ? cheques.find((c) => normCheque(c.cheque_number) === no) : undefined) ??
      cheques.find((c) => c.status !== "cancelled" && Math.abs(Number(c.amount) - amt) < 0.01 && (!d.supplier_id || c.supplier_id === d.supplier_id));
    const supplierId = d.supplier_id ?? chq?.supplier_id ?? null;
    const sup = supplierId ? supById.get(supplierId) : undefined;
    const vd = d.value_date && d.value_date <= d.op_date ? d.value_date : d.op_date;
    return {
      month,
      inv_date: chq?.issue_date ?? vd,
      supplier_id: supplierId,
      supplier_name: sup?.name ?? null,
      amount_ttc: amt,
      vat_rate: sup?.vat_rate ?? 20,
      payment_mode: /EFFET|LCN/i.test(d.label) ? "effet" : /CHEQUE/i.test(d.label) ? "cheque" : "virement",
      cheque_number: no ?? chq?.cheque_number ?? null,
      bank_transaction_id: d.id,
      sort_order: sortBase,
    };
  }

  async function importPurchases() {
    const rows = debitsLeft.filter((d) => isSupplierDebit(d.label, d.kind)).map((d, i) => purchaseFromTx(d, purchases.length + i));
    if (!rows.length) return showFlash(t("dc_nothing_to_import"));
    setBusy(true);
    const { error } = await supabase.from("purchase_invoices").insert(rows);
    setBusy(false);
    if (error) return showFlash(error.message);
    showFlash(`${rows.length} ${t("dc_rows_imported")}`);
    load();
  }
  async function addPurchaseFromTx(d: BankTransaction) {
    await supabase.from("purchase_invoices").insert(purchaseFromTx(d, purchases.length));
    load();
  }
  async function addPurchaseManual() {
    await supabase.from("purchase_invoices").insert({
      month, inv_date: `${month}-01`, amount_ttc: 0, vat_rate: 20, payment_mode: "cheque", sort_order: purchases.length,
    });
    load();
  }
  async function patchPurchase(p: PurchaseInvoice, patch: Partial<PurchaseInvoice>) {
    if (patch.supplier_id !== undefined) {
      const sup = patch.supplier_id ? supById.get(patch.supplier_id) : undefined;
      patch.supplier_name = sup?.name ?? null;
      if (sup?.vat_rate != null) patch.vat_rate = Number(sup.vat_rate);
    }
    setPurchases((old) => old.map((x) => (x.id === p.id ? { ...x, ...patch } : x)));
    const { error } = await supabase.from("purchase_invoices").update(patch).eq("id", p.id);
    if (error) showFlash(error.message);
  }
  async function deletePurchase(p: PurchaseInvoice) {
    if (!confirm(t("dc_confirm_delete_row"))) return;
    await supabase.from("purchase_invoices").delete().eq("id", p.id);
    setPurchases((old) => old.filter((x) => x.id !== p.id));
  }

  // ---------------------------------------------------------------- étape 2 : ventes
  function saleFromTx(d: BankTransaction) {
    return {
      month,
      inv_date: d.op_date,
      target_ttc: Math.abs(Number(d.amount)),
      discount_rate: 0,
      vat_rate: 20,
      payment_mode: saleModeFromLabel(d.label),
      bank_transaction_id: d.id,
      source: "dossier",
      status: "draft",
    };
  }
  async function importSales() {
    const rows = creditsLeft.map(saleFromTx);
    if (!rows.length) return showFlash(t("dc_nothing_to_import"));
    setBusy(true);
    const { error } = await supabase.from("sales_invoices").insert(rows);
    setBusy(false);
    if (error) return showFlash(error.message);
    showFlash(`${rows.length} ${t("dc_rows_imported")}`);
    load();
  }
  async function addSaleFromTx(d: BankTransaction) {
    await supabase.from("sales_invoices").insert(saleFromTx(d));
    load();
  }
  async function addSaleManual() {
    await supabase.from("sales_invoices").insert({
      month, inv_date: `${month}-01`, target_ttc: 0, discount_rate: 0, vat_rate: 20, payment_mode: "espece", source: "dossier", status: "draft",
    });
    load();
  }
  /** Modifie une facture du registre. Un changement de montant/taux invalide ses lignes. */
  async function patchSale(x: DossierInvoice, patch: Partial<DossierInvoice>, { lock = false } = {}) {
    if (x.status === "final") return;
    if (patch.client_id !== undefined) {
      const c = patch.client_id ? cliById.get(patch.client_id) : undefined;
      Object.assign(patch, {
        client_name: c?.name ?? null, client_ice: c?.ice ?? null, client_if: c?.if_num ?? null, client_address: c?.address ?? null,
      });
    }
    const invalidates = ("vat_rate" in patch && Number(patch.vat_rate) !== invRate(x)) ||
      ("target_ttc" in patch && Number(patch.target_ttc) !== Number(x.target_ttc));
    if (lock) setLocked((s) => new Set(s).add(x.id));
    setInvoices((old) => old.map((i) => (i.id === x.id ? { ...i, ...patch } : i)));
    if (invalidates && (itemsByInv.get(x.id)?.length ?? 0) > 0) {
      await supabase.from("sales_invoice_items").delete().eq("invoice_id", x.id);
      setItems((old) => old.filter((i) => i.invoice_id !== x.id));
    }
    const { error } = await supabase.from("sales_invoices").update(patch).eq("id", x.id);
    if (error) showFlash(error.message);
  }
  async function deleteSale(x: DossierInvoice) {
    if (x.status === "final" && !confirm(t("dc_confirm_delete_final"))) return;
    if (x.status !== "final" && !confirm(t("dc_confirm_delete_row"))) return;
    await supabase.from("sales_invoices").delete().eq("id", x.id);
    load();
  }

  const balance = useMemo(
    () =>
      balanceRates(
        invoices.map((x) => ({ id: x.id, ttc: Number(x.target_ttc), rate: invRate(x), locked: locked.has(x.id) || x.status === "final" || ![0, 20].includes(invRate(x)) })),
        deductible,
        { highRate: 20, capZero: capByRate.get(0) ?? 0, capHigh: capByRate.get(20) ?? 0 }
      ),
    [invoices, locked, deductible, capByRate]
  );

  async function applyBalance() {
    setBusy(true);
    for (const x of invoices) {
      const r = balance.rates[x.id];
      if (r !== undefined && r !== invRate(x)) await patchSale(x, { vat_rate: r });
    }
    setBusy(false);
    showFlash(t(balance.feasible ? "dc_balanced" : "dc_balanced_partial"));
  }

  // ---------------------------------------------------------------- étape 3 : factures
  async function generateLines() {
    const drafts = invoices.filter((x) => x.status === "draft" && Number(x.target_ttc) > 0);
    if (!drafts.length) return;
    if (drafts.some((x) => (itemsByInv.get(x.id)?.length ?? 0) > 0) && !confirm(t("dc_confirm_regen"))) return;
    setBusy(true);
    try {
      const avail = new Map(pool.map((l) => [l.product_id, l.qty] as const));
      // les lignes des factures déjà finalisées du dossier consomment le pool
      for (const it of items) {
        const inv = invoices.find((x) => x.id === it.invoice_id);
        if (inv?.status === "final" && it.product_id) avail.set(it.product_id, (avail.get(it.product_id) ?? 0) - Number(it.quantity));
      }
      await supabase.from("sales_invoice_items").delete().in("invoice_id", drafts.map((x) => x.id));
      const order = [...drafts].sort((a, b) => Number(b.target_ttc) - Number(a.target_ttc));
      const rows: Omit<SalesInvoiceItem, "id">[] = [];
      let short = 0;
      for (const x of order) {
        const { lines, ttc } = fillInvoice(pool, avail, invRate(x), Number(x.target_ttc));
        if (Math.abs(ttc - Number(x.target_ttc)) > 1) short++;
        lines.forEach((l, i) => rows.push({ invoice_id: x.id, sort_order: i, ...l }));
      }
      if (rows.length) {
        const { error } = await supabase.from("sales_invoice_items").insert(rows);
        if (error) throw error;
      }
      showFlash(short ? `${t("dc_generated")} — ${short} ${t("dc_short_invoices")}` : t("dc_generated"));
    } catch (e) {
      console.error(e);
      showFlash(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      load();
    }
  }

  async function finalizeAll() {
    const drafts = invoices.filter((x) => x.status === "draft");
    if (!drafts.length || !confirm(t("inv_confirm_finalize"))) return;
    setBusy(true);
    const { data: maxRow } = await supabase
      .from("sales_invoices").select("inv_number").not("inv_number", "is", null)
      .order("inv_number", { ascending: false }).limit(1).maybeSingle();
    let n = Math.max(parseInt(startNumber, 10) || 1, ((maxRow as { inv_number: number } | null)?.inv_number ?? 0) + 1);
    for (const d of drafts) {
      await supabase.from("sales_invoices").update({ inv_number: n, status: "final" }).eq("id", d.id);
      n++;
    }
    await supabase.from("app_settings").upsert({ key: "invoice_start_number", value: String(n) }, { onConflict: "key" });
    setBusy(false);
    showFlash(t("saved"));
    load();
  }

  // éditeur de lignes
  function openEditor(x: DossierInvoice) {
    setEditId(x.id);
    setAddProduct("");
    setDraftItems((itemsByInv.get(x.id) ?? []).map((i) => ({ ...i })));
  }
  const editing = invoices.find((x) => x.id === editId) ?? null;
  const availFor = (productId: string) => {
    const poolQty = pool.find((p) => p.product_id === productId)?.qty ?? 0;
    const elsewhere = items.filter((i) => i.product_id === productId && i.invoice_id !== editId).reduce((s, i) => s + Number(i.quantity), 0);
    return poolQty - elsewhere;
  };
  async function saveLines() {
    if (!editId) return;
    await supabase.from("sales_invoice_items").delete().eq("invoice_id", editId);
    const rows = draftItems.filter((l) => Number(l.quantity) > 0).map((l, i) => ({
      invoice_id: editId, product_id: l.product_id, designation: l.designation, unit: l.unit,
      quantity: Number(l.quantity), unit_price: Number(l.unit_price), vat_rate: Number(l.vat_rate), sort_order: i,
    }));
    if (rows.length) await supabase.from("sales_invoice_items").insert(rows);
    setEditId(null);
    showFlash(t("saved"));
    load();
  }

  // ---------------------------------------------------------------- export Excel
  async function exportRegisters() {
    const hdr = (who: string): Cell[] => ["N°", "Date", who, "Montant HT", "Montant TVA", "Montant TTC", "TVA %", "Mode du règlement", "Date d'échéance"];
    const pRows: Cell[][] = [hdr("Frs")];
    for (const p of purchases) {
      const { ht, vat } = splitTTC(Number(p.amount_ttc), Number(p.vat_rate));
      pRows.push([p.ref ?? "", fmtD(p.inv_date), p.supplier_name ?? "", ht, vat, Number(p.amount_ttc), Number(p.vat_rate), t(`dc_mode_${p.payment_mode}`), p.due_date ? fmtD(p.due_date) : ""]);
    }
    pRows.push(["", "", "Total", round2(pTot.ht), round2(pTot.vat), round2(pTot.ttc), "", "", ""]);
    const sRows: Cell[][] = [hdr("Clients")];
    for (const x of invoices) {
      const { ht, vat } = splitTTC(Number(x.target_ttc), invRate(x));
      sRows.push([numberOf(x), fmtD(x.inv_date), x.client_name ?? "", ht, vat, Number(x.target_ttc), invRate(x), x.payment_mode ? t(`dc_mode_${x.payment_mode}`) : "", ""]);
    }
    sRows.push(["", "", "Total", round2(sTot.ttc - sTot.vat), sTot.vat, round2(sTot.ttc), "", "", ""]);
    const [y, m] = month.split("-");
    const w = [8, 12, 26, 14, 14, 14, 8, 16, 14];
    const blob = await buildXlsx([
      { name: `Achats ${m}-${y}`, rows: pRows, colWidths: w },
      { name: `Ventes ${m}-${y}`, rows: sRows, colWidths: w },
    ]);
    downloadFile(`Dossier comptable ${m}-${y}.xlsx`, blob);
  }

  // ---------------------------------------------------------------- rendu documents
  const viewInv = invoices.find((x) => x.id === viewId) ?? null;
  const docOf = (x: DossierInvoice): SalesInvoice => ({ ...x, inv_number: numberOf(x) });
  if (viewInv)
    return <InvoiceDoc invoice={docOf(viewInv)} items={itemsByInv.get(viewInv.id) ?? []} onBack={() => setViewId(null)} t={t} lang={lang} />;
  if (printAll)
    return (
      <div>
        <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
          <button onClick={() => setPrintAll(false)} className="rounded-lg border border-border px-4 py-2 text-sm">{t("back_to_list")}</button>
          <button onClick={() => window.print()} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold">🖨️ {t("print_pdf")}</button>
        </div>
        {invoices.filter((x) => (itemsByInv.get(x.id)?.length ?? 0) > 0).map((x) => (
          <div key={x.id} className="invoice-sheet mb-6">
            <InvoiceDoc invoice={docOf(x)} items={itemsByInv.get(x.id) ?? []} t={t} lang={lang} />
          </div>
        ))}
      </div>
    );

  const stepDone = { 1: purchases.length > 0, 2: invoices.length > 0, 3: invoices.length > 0 && invoices.every((x) => x.status === "final") };

  // ---------------------------------------------------------------- UI
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("dc_title")}</h1>
          <p className="max-w-2xl text-sm text-muted">{t("dc_hint")}</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-2 outline-none focus:border-primary" />
          <button onClick={exportRegisters} disabled={loading} className="rounded-lg border border-border px-3 py-2 text-sm">
            ⬇️ {t("dc_export")}
          </button>
        </div>
      </div>

      {flash && <div className="mb-4 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm text-primary">{flash}</div>}

      {migrationMissing && (
        <div className="mb-4 rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm">{t("dc_migration_missing")}</div>
      )}

      {/* ---------- étapes ---------- */}
      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        {([1, 2, 3] as const).map((s) => (
          <button key={s} onClick={() => setStep(s)}
            className={`card flex items-center gap-3 p-3 text-start ${step === s ? "border-primary ring-1 ring-primary" : ""}`}>
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${stepDone[s] ? "bg-primary text-primary-fg" : "bg-border"}`}>
              {stepDone[s] ? "✓" : s}
            </span>
            <span>
              <span className="block text-sm font-semibold">{t(`dc_step${s}`)}</span>
              <span className="block text-xs text-muted">{t(`dc_step${s}_sub`)}</span>
            </span>
          </button>
        ))}
      </div>

      {/* ---------- bandeau TVA (toujours visible) ---------- */}
      <div className="card mb-4 grid grid-cols-2 gap-3 p-4 text-sm sm:grid-cols-4">
        <div>
          <div className="text-muted">{t("dc_vat_deductible")}</div>
          <div className="text-lg font-bold">{fmtMoney(deductible, lang)}</div>
        </div>
        <div>
          <div className="text-muted">{t("dc_vat_collected")}</div>
          <div className="text-lg font-bold">{fmtMoney(sTot.vat, lang)}</div>
        </div>
        <div>
          <div className="text-muted">{vatDue >= 0 ? t("dc_vat_due") : t("dc_vat_credit")}</div>
          <div className={`text-lg font-bold ${vatDue < 0 ? "text-accent" : "text-primary"}`}>{fmtMoney(Math.abs(vatDue), lang)}</div>
        </div>
        <div>
          <div className="text-muted">{t("dc_credited_vs_invoiced")}</div>
          <div className="text-lg font-bold">{fmtMoney(sTot.ttc, lang)}</div>
          <div className={`text-xs ${Math.abs(sTot.ttc - credited) > 1 ? "text-accent" : "text-muted"}`}>
            {t("dc_credited")} {fmtMoney(credited, lang)}
          </div>
        </div>
      </div>

      {loading ? (
        <p className="p-8 text-center text-muted">{t("loading")}</p>
      ) : (
        <>
          <p className="mb-3 text-sm capitalize text-muted">{monthLabel(month, lang)}</p>
          {txs.length === 0 && (
            <div className="mb-4 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
              {t("dc_no_statement")} <Link href="/banque" className="font-semibold text-primary underline">{t("nav_bank")}</Link>
            </div>
          )}

          {/* ======================= ÉTAPE 1 ======================= */}
          {step === 1 && (
            <>
              <div className="card mb-4 flex flex-wrap items-center gap-3 p-4">
                <button onClick={importPurchases} disabled={busy || migrationMissing}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg disabled:opacity-50">
                  {t("dc_import_cheques")} ({debitsLeft.filter((d) => isSupplierDebit(d.label, d.kind)).length})
                </button>
                <button onClick={addPurchaseManual} disabled={migrationMissing} className="rounded-lg border border-border px-4 py-2 text-sm">
                  + {t("dc_add_manual")}
                </button>
                <span className="text-xs text-muted">{t("dc_step1_help")}</span>
              </div>

              <div className="card mb-4 overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted">
                      <th className="px-2 py-2 text-start font-medium">{t("date")}</th>
                      <th className="px-2 py-2 text-start font-medium">{t("supplier")}</th>
                      <th className="px-2 py-2 text-start font-medium">{t("dc_ref")}</th>
                      <th className="px-2 py-2 text-end font-medium">{t("total_ttc")}</th>
                      <th className="px-2 py-2 text-end font-medium">{t("vat")}</th>
                      <th className="px-2 py-2 text-end font-medium">{t("total_ht")}</th>
                      <th className="px-2 py-2 text-end font-medium">{t("vat_amount")}</th>
                      <th className="px-2 py-2 text-start font-medium">{t("dc_mode")}</th>
                      <th className="px-2 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {purchases.length === 0 && (
                      <tr><td colSpan={9} className="p-6 text-center text-muted">{t("dc_no_rows")}</td></tr>
                    )}
                    {purchases.map((p) => {
                      const { ht, vat } = splitTTC(Number(p.amount_ttc), Number(p.vat_rate));
                      return (
                        <tr key={p.id} className={!p.supplier_id ? "bg-accent/5" : ""}>
                          <td className="px-2 py-1.5">
                            <input type="date" defaultValue={p.inv_date} onBlur={(e) => e.target.value !== p.inv_date && patchPurchase(p, { inv_date: e.target.value })} className="input w-36" />
                          </td>
                          <td className="px-2 py-1.5">
                            <select value={p.supplier_id ?? ""} onChange={(e) => patchPurchase(p, { supplier_id: e.target.value || null })} className="input w-44">
                              <option value="">— {t("dc_choose")} —</option>
                              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-1.5">
                            <input defaultValue={p.ref ?? ""} placeholder={p.cheque_number ? `Chq ${p.cheque_number}` : ""}
                              onBlur={(e) => e.target.value !== (p.ref ?? "") && patchPurchase(p, { ref: e.target.value || null })} className="input w-28" />
                          </td>
                          <td className="px-2 py-1.5 text-end">
                            <input type="number" step="0.01" dir="ltr" defaultValue={Number(p.amount_ttc)}
                              onBlur={(e) => Number(e.target.value) !== Number(p.amount_ttc) && patchPurchase(p, { amount_ttc: Number(e.target.value) || 0 })}
                              className="input w-28 text-end" />
                          </td>
                          <td className="px-2 py-1.5 text-end">
                            <select value={Number(p.vat_rate)} onChange={(e) => patchPurchase(p, { vat_rate: Number(e.target.value) })} className="input w-20">
                              {VAT_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-1.5 text-end">{fmtMoney(ht, lang)}</td>
                          <td className="px-2 py-1.5 text-end font-medium">{fmtMoney(vat, lang)}</td>
                          <td className="px-2 py-1.5">
                            <select value={p.payment_mode} onChange={(e) => patchPurchase(p, { payment_mode: e.target.value })} className="input w-28">
                              {PURCHASE_MODES.map((m) => <option key={m} value={m}>{t(`dc_mode_${m}`)}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-1.5 text-end">
                            <button onClick={() => deletePurchase(p)} className="text-muted hover:text-accent" title={t("delete")}>✕</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {purchases.length > 0 && (
                    <tfoot className="border-t-2 border-border font-semibold">
                      {pTot.byRate.map(([r, v]) => (
                        <tr key={r} className="text-muted">
                          <td colSpan={3} className="px-2 py-1 text-end text-xs">{t("vat")} {r}%</td>
                          <td className="px-2 py-1 text-end text-xs">{fmtMoney(v.ttc, lang)}</td>
                          <td></td>
                          <td className="px-2 py-1 text-end text-xs">{fmtMoney(v.ht, lang)}</td>
                          <td className="px-2 py-1 text-end text-xs">{fmtMoney(v.vat, lang)}</td>
                          <td colSpan={2}></td>
                        </tr>
                      ))}
                      <tr>
                        <td colSpan={3} className="px-2 py-2 text-end">Total</td>
                        <td className="px-2 py-2 text-end">{fmtMoney(pTot.ttc, lang)}</td>
                        <td></td>
                        <td className="px-2 py-2 text-end">{fmtMoney(pTot.ht, lang)}</td>
                        <td className="px-2 py-2 text-end text-primary">{fmtMoney(pTot.vat, lang)}</td>
                        <td colSpan={2}></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {debitsLeft.length > 0 && (
                <details className="card mb-4 p-4">
                  <summary className="cursor-pointer text-sm font-semibold">{t("dc_other_debits")} ({debitsLeft.length})</summary>
                  <table className="mt-3 w-full text-sm">
                    <tbody className="divide-y divide-border">
                      {debitsLeft.map((d) => (
                        <tr key={d.id}>
                          <td className="px-2 py-1.5 whitespace-nowrap">{fmtD(d.op_date)}</td>
                          <td className="px-2 py-1.5">{d.label}</td>
                          <td className="px-2 py-1.5 text-end whitespace-nowrap">{fmtMoney(Math.abs(Number(d.amount)), lang)}</td>
                          <td className="px-2 py-1.5 text-end">
                            <button onClick={() => addPurchaseFromTx(d)} disabled={migrationMissing} className="rounded border border-border px-2 py-0.5 text-xs">+ {t("dc_add")}</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}

              <div className="flex justify-end">
                <button onClick={() => setStep(2)} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg">{t("dc_next")} →</button>
              </div>
            </>
          )}

          {/* ======================= ÉTAPE 2 ======================= */}
          {step === 2 && (
            <>
              <div className="card mb-4 flex flex-wrap items-center gap-3 p-4">
                <button onClick={importSales} disabled={busy || migrationMissing}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg disabled:opacity-50">
                  {t("dc_import_credits")} ({creditsLeft.length})
                </button>
                <button onClick={addSaleManual} disabled={migrationMissing} className="rounded-lg border border-border px-4 py-2 text-sm">+ {t("dc_add_manual")}</button>
                <label className="ms-auto flex items-center gap-2 text-sm text-muted">
                  {t("inv_start_number")}
                  <input type="number" value={startNumber} dir="ltr" onChange={(e) => setStartNumber(e.target.value)}
                    onBlur={() => supabase.from("app_settings").upsert({ key: "invoice_start_number", value: startNumber }, { onConflict: "key" })}
                    className="input w-24" />
                </label>
              </div>

              {/* équilibrage */}
              {invoices.length > 0 && (
                <div className="card mb-4 p-4 text-sm">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="font-semibold">⚖️ {t("dc_balance_title")}</div>
                    <span className="text-muted">
                      {t("dc_balance_proposal")} : {fmtMoney(balance.collected, lang)} ({t("dc_vat_due")} {fmtMoney(round2(balance.collected - deductible), lang)})
                    </span>
                    <button onClick={applyBalance} disabled={busy}
                      className="ms-auto rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg disabled:opacity-50">
                      {t("dc_balance_apply")}
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-muted">{t("dc_balance_help")}</p>
                  {!balance.feasible && <p className="mt-1 text-xs text-accent">{t("dc_balance_infeasible")}</p>}
                  <div className="mt-3 flex flex-wrap gap-4 text-xs">
                    {[...new Set([...capByRate.keys(), ...sTot.byRate.keys()])].sort((a, b) => b - a).map((r) => {
                      const cap = capByRate.get(r) ?? 0;
                      const inv = sTot.byRate.get(r) ?? 0;
                      return (
                        <div key={r} className={inv > cap + 1 ? "text-accent" : "text-muted"}>
                          {t("vat")} {r}% : {t("dc_invoiced")} {fmtMoney(inv, lang)} / {t("dc_sold")} {fmtMoney(cap, lang)}
                          {inv > cap + 1 && ` ⚠️ ${t("dc_over_sold")}`}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="card mb-4 overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted">
                      <th className="px-2 py-2 text-start font-medium">N°</th>
                      <th className="px-2 py-2 text-start font-medium">{t("date")}</th>
                      <th className="px-2 py-2 text-start font-medium">{t("inv_client")}</th>
                      <th className="px-2 py-2 text-end font-medium">{t("total_ttc")}</th>
                      <th className="px-2 py-2 text-center font-medium">{t("vat")}</th>
                      <th className="px-2 py-2 text-end font-medium">{t("total_ht")}</th>
                      <th className="px-2 py-2 text-end font-medium">{t("vat_amount")}</th>
                      <th className="px-2 py-2 text-start font-medium">{t("dc_mode")}</th>
                      <th className="px-2 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {invoices.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-muted">{t("dc_no_rows")}</td></tr>}
                    {invoices.map((x) => {
                      const r = invRate(x);
                      const { ht, vat } = splitTTC(Number(x.target_ttc), r);
                      const fin = x.status === "final";
                      return (
                        <tr key={x.id} className={fin ? "opacity-70" : ""}>
                          <td className="px-2 py-1.5 font-medium">
                            {numberOf(x)}
                            {!fin && <span className="ms-1 text-[10px] text-muted">({t("inv_status_draft")})</span>}
                          </td>
                          <td className="px-2 py-1.5">
                            <input type="date" defaultValue={x.inv_date} disabled={fin}
                              onBlur={(e) => e.target.value !== x.inv_date && patchSale(x, { inv_date: e.target.value })} className="input w-36" />
                          </td>
                          <td className="px-2 py-1.5">
                            <select value={x.client_id ?? ""} disabled={fin} onChange={(e) => patchSale(x, { client_id: e.target.value || null })} className="input w-44">
                              <option value="">{t("dc_no_client")}</option>
                              {clients.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-1.5 text-end">
                            <input type="number" step="0.01" dir="ltr" defaultValue={Number(x.target_ttc)} disabled={fin}
                              onBlur={(e) => Number(e.target.value) !== Number(x.target_ttc) && patchSale(x, { target_ttc: Number(e.target.value) || 0 })}
                              className="input w-28 text-end" />
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <div className="inline-flex items-center gap-1">
                              {[20, 0].map((v) => (
                                <button key={v} disabled={fin} onClick={() => patchSale(x, { vat_rate: v }, { lock: true })}
                                  className={`rounded px-2 py-0.5 text-xs font-semibold ${r === v ? (v ? "bg-primary text-primary-fg" : "bg-accent text-white") : "border border-border text-muted"}`}>
                                  {v}%
                                </button>
                              ))}
                              {![0, 20].includes(r) && <span className="text-xs">{r}%</span>}
                              {locked.has(x.id) && !fin && (
                                <button title={t("dc_unlock")} onClick={() => setLocked((s) => { const n = new Set(s); n.delete(x.id); return n; })} className="text-xs">🔒</button>
                              )}
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-end">{fmtMoney(ht, lang)}</td>
                          <td className="px-2 py-1.5 text-end font-medium">{fmtMoney(vat, lang)}</td>
                          <td className="px-2 py-1.5">
                            <select value={x.payment_mode ?? "autre"} disabled={fin} onChange={(e) => patchSale(x, { payment_mode: e.target.value })} className="input w-28">
                              {SALE_MODES.map((m) => <option key={m} value={m}>{t(`dc_mode_${m}`)}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-1.5 text-end">
                            <button onClick={() => deleteSale(x)} className="text-muted hover:text-accent" title={t("delete")}>✕</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {invoices.length > 0 && (
                    <tfoot className="border-t-2 border-border font-semibold">
                      <tr>
                        <td colSpan={3} className="px-2 py-2 text-end">Total</td>
                        <td className="px-2 py-2 text-end">{fmtMoney(sTot.ttc, lang)}</td>
                        <td></td>
                        <td className="px-2 py-2 text-end">{fmtMoney(sTot.ttc - sTot.vat, lang)}</td>
                        <td className="px-2 py-2 text-end text-primary">{fmtMoney(sTot.vat, lang)}</td>
                        <td colSpan={2}></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {creditsLeft.length > 0 && invoices.length > 0 && (
                <details className="card mb-4 p-4">
                  <summary className="cursor-pointer text-sm font-semibold">{t("dc_other_credits")} ({creditsLeft.length})</summary>
                  <table className="mt-3 w-full text-sm">
                    <tbody className="divide-y divide-border">
                      {creditsLeft.map((d) => (
                        <tr key={d.id}>
                          <td className="px-2 py-1.5 whitespace-nowrap">{fmtD(d.op_date)}</td>
                          <td className="px-2 py-1.5">{d.label}</td>
                          <td className="px-2 py-1.5 text-end whitespace-nowrap">{fmtMoney(Math.abs(Number(d.amount)), lang)}</td>
                          <td className="px-2 py-1.5 text-end">
                            <button onClick={() => addSaleFromTx(d)} className="rounded border border-border px-2 py-0.5 text-xs">+ {t("dc_add")}</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}

              <div className="flex justify-between">
                <button onClick={() => setStep(1)} className="rounded-lg border border-border px-4 py-2 text-sm">← {t("dc_prev")}</button>
                <button onClick={() => setStep(3)} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg">{t("dc_next")} →</button>
              </div>
            </>
          )}

          {/* ======================= ÉTAPE 3 ======================= */}
          {step === 3 && (
            <>
              <div className="card mb-4 flex flex-wrap items-center gap-3 p-4">
                <button onClick={generateLines} disabled={busy || !invoices.some((x) => x.status === "draft")}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg disabled:opacity-50">
                  {busy ? t("inv_generating") : t("dc_generate_lines")}
                </button>
                {invoices.some((x) => x.status === "draft") && (
                  <button onClick={finalizeAll} disabled={busy} className="rounded-lg border border-border px-4 py-2 text-sm font-medium">{t("inv_finalize_all")}</button>
                )}
                <button onClick={() => setPrintAll(true)} disabled={!items.length} className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-50">
                  🖨️ {t("dc_print_all")}
                </button>
                <span className="text-xs text-muted">{t("dc_step3_help")}</span>
              </div>
              {pool.length === 0 && <div className="mb-4 rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm">{t("dc_no_sales")}</div>}

              <div className="card mb-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted">
                      <th className="px-3 py-2 text-start font-medium">N°</th>
                      <th className="px-3 py-2 text-start font-medium">{t("date")}</th>
                      <th className="px-3 py-2 text-start font-medium">{t("inv_client")}</th>
                      <th className="px-3 py-2 text-center font-medium">{t("vat")}</th>
                      <th className="px-3 py-2 text-end font-medium">{t("inv_target")}</th>
                      <th className="px-3 py-2 text-end font-medium">{t("inv_realized")}</th>
                      <th className="px-3 py-2 text-end font-medium">{t("inv_gap")}</th>
                      <th className="px-3 py-2 text-start font-medium">{t("status")}</th>
                      <th className="px-3 py-2 text-center font-medium">{t("actions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {invoices.map((x) => {
                      const n = itemsByInv.get(x.id)?.length ?? 0;
                      const real = invReal(x.id);
                      const gap = real - Number(x.target_ttc);
                      return (
                        <tr key={x.id}>
                          <td className="px-3 py-2 font-medium">{numberOf(x)}</td>
                          <td className="px-3 py-2">{fmtD(x.inv_date)}</td>
                          <td className="px-3 py-2">{x.client_name || "—"}</td>
                          <td className="px-3 py-2 text-center">{invRate(x)}%</td>
                          <td className="px-3 py-2 text-end">{fmtMoney(Number(x.target_ttc), lang)}</td>
                          <td className="px-3 py-2 text-end font-medium">{n ? fmtMoney(real, lang) : <span className="text-muted">{t("dc_no_lines")}</span>}</td>
                          <td className={`px-3 py-2 text-end ${!n ? "" : Math.abs(gap) < 1 ? "text-muted" : "text-accent"}`}>{n ? fmtMoney(gap, lang) : ""}</td>
                          <td className="px-3 py-2">{t(x.status === "final" ? "inv_status_final" : "inv_status_draft")}</td>
                          <td className="px-3 py-2 text-center whitespace-nowrap">
                            {x.status === "draft" && (
                              <button onClick={() => openEditor(x)} className="me-2 rounded border border-border px-2 py-0.5 text-xs">{t("dc_lines")}</button>
                            )}
                            <button onClick={() => setViewId(x.id)} disabled={!n} className="rounded border border-border px-2 py-0.5 text-xs disabled:opacity-40">{t("dc_view_pdf")}</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* éditeur de lignes */}
              {editing && (
                <div className="card mb-4 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="font-semibold">
                      N° {numberOf(editing)} — {t("inv_target")} {fmtMoney(Number(editing.target_ttc), lang)} · {invRate(editing)}%
                    </div>
                    <div className={`text-sm font-semibold ${Math.abs(linesTTC(draftItems.map((d) => ({ quantity: Number(d.quantity), unit_price: Number(d.unit_price), vat_rate: Number(d.vat_rate) }))) - Number(editing.target_ttc)) < 1 ? "text-primary" : "text-accent"}`}>
                      {t("inv_realized")} : {fmtMoney(linesTTC(draftItems.map((d) => ({ quantity: Number(d.quantity), unit_price: Number(d.unit_price), vat_rate: Number(d.vat_rate) }))), lang)}
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-muted">
                        <th className="px-2 py-1 text-start font-medium">{t("designation")}</th>
                        <th className="px-2 py-1 text-end font-medium">{t("quantity")}</th>
                        <th className="px-2 py-1 text-end font-medium">{t("dc_available")}</th>
                        <th className="px-2 py-1 text-end font-medium">{t("unit_price_ht")}</th>
                        <th className="px-2 py-1 text-end font-medium">{t("total_ht")}</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {draftItems.map((l, i) => {
                        const max = l.product_id ? availFor(l.product_id) : Infinity;
                        const over = Number(l.quantity) > max + 1e-6;
                        return (
                          <tr key={l.id || i}>
                            <td className="px-2 py-1" dir="auto">{l.designation}</td>
                            <td className="px-2 py-1 text-end">
                              <input type="number" dir="ltr" value={l.quantity}
                                onChange={(e) => setDraftItems((d) => d.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))}
                                className={`input w-24 text-end ${over ? "border-accent text-accent" : ""}`} />
                            </td>
                            <td className="px-2 py-1 text-end text-muted">{Number.isFinite(max) ? fmtNum(max, lang) : "—"}</td>
                            <td className="px-2 py-1 text-end">
                              <input type="number" step="0.001" dir="ltr" value={l.unit_price}
                                onChange={(e) => setDraftItems((d) => d.map((x, j) => (j === i ? { ...x, unit_price: Number(e.target.value) } : x)))}
                                className="input w-28 text-end" />
                            </td>
                            <td className="px-2 py-1 text-end">{fmtMoney(Number(l.quantity) * Number(l.unit_price), lang)}</td>
                            <td className="px-2 py-1 text-end">
                              <button onClick={() => setDraftItems((d) => d.filter((_, j) => j !== i))} className="text-muted hover:text-accent">✕</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <select value={addProduct} onChange={(e) => setAddProduct(e.target.value)} className="input max-w-xs">
                      <option value="">+ {t("dc_add_product")}</option>
                      {pool.filter((p) => p.vat === invRate(editing) && !draftItems.some((d) => d.product_id === p.product_id)).map((p) => (
                        <option key={p.product_id} value={p.product_id}>{p.name} ({t("dc_available")} {fmtNum(availFor(p.product_id), lang)})</option>
                      ))}
                    </select>
                    <button disabled={!addProduct} className="rounded border border-border px-3 py-1.5 text-sm disabled:opacity-40"
                      onClick={() => {
                        const p = pool.find((x) => x.product_id === addProduct);
                        if (!p) return;
                        setDraftItems((d) => [...d, { id: "", invoice_id: editing.id, product_id: p.product_id, designation: p.name, unit: p.unit, quantity: 1, unit_price: round2(p.pu), vat_rate: p.vat, sort_order: d.length }]);
                        setAddProduct("");
                      }}>
                      {t("dc_add")}
                    </button>
                    <div className="ms-auto flex gap-2">
                      <button onClick={() => setEditId(null)} className="rounded-lg border border-border px-4 py-2 text-sm">{t("cancel")}</button>
                      <button onClick={saveLines}
                        disabled={draftItems.some((l) => l.product_id && Number(l.quantity) > availFor(l.product_id) + 1e-6)}
                        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg disabled:opacity-50">{t("save")}</button>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-start">
                <button onClick={() => setStep(2)} className="rounded-lg border border-border px-4 py-2 text-sm">← {t("dc_prev")}</button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
