"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { fmtNum, fmtPct } from "@/lib/format";
import { parseProductsCsv, buildTemplateCsv, type ParsedProductRow } from "@/lib/productImport";
import type { Product, Supplier } from "@/lib/types";

export default function ProduitsPage() {
  const { t, lang } = useI18n();
  const supabase = useMemo(() => createClient(), []);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", designation: "", category: "", unit: "", pa: "", pv: "", pvTraiteur: "", vat: "", supplier: "" });
  const fileRef = useRef<HTMLInputElement>(null);
  const [importRows, setImportRows] = useState<ParsedProductRow[] | null>(null);
  const [importErr, setImportErr] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("suppliers").select("*").order("sort_order");
      setSuppliers((data as Supplier[]) ?? []);
    })();
  }, [supabase]);

  async function reload() {
    setLoading(true);
    const { data } = await supabase.from("products").select("*").order("sort_order");
    setProducts((data as Product[]) ?? []);
    setLoading(false);
  }
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) if (p.category) set.add(p.category);
    return Array.from(set).sort((a, b) => a.localeCompare(b, lang === "ar" ? "ar" : "fr"));
  }, [products, lang]);

  // Réinitialise la catégorie si elle n'existe plus pour le vendeur choisi
  useEffect(() => {
    if (category !== "all" && !categories.includes(category)) setCategory("all");
  }, [categories, category]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return products.filter((p) => {
      if (category !== "all" && (p.category ?? "") !== category) return false;
      if (s && !(p.name.toLowerCase().includes(s) || (p.name_fr ?? "").toLowerCase().includes(s) || (p.category ?? "").toLowerCase().includes(s))) return false;
      return true;
    });
  }, [products, search, category]);

  async function updateField(
    p: Product,
    field: "purchase_price" | "sale_price" | "traiteur_price" | "vat_rate" | "name" | "name_fr" | "category" | "supplier_id",
    value: string
  ) {
    const numeric = field === "purchase_price" || field === "sale_price" || field === "vat_rate";
    const patch: Partial<Product> = field === "traiteur_price"
      ? { traiteur_price: value.trim() === "" ? null : parseFloat(value) || 0 }
      : numeric
      ? { [field]: parseFloat(value) || 0 }
      : field === "supplier_id"
      ? { supplier_id: value || null }
      : { [field]: value };
    setProducts((old) => old.map((x) => (x.id === p.id ? { ...x, ...patch } : x)));
    await supabase.from("products").update(patch).eq("id", p.id);
  }

  async function addProduct() {
    if (!form.name) return;
    const maxOrder = products.reduce((m, p) => Math.max(m, p.sort_order), 0);
    await supabase.from("products").insert({
      supplier_id: form.supplier || null,
      name: form.name,
      name_fr: form.designation || null,
      category: form.category || null,
      unit: form.unit || null,
      purchase_price: parseFloat(form.pa) || 0,
      sale_price: parseFloat(form.pv) || 0,
      traiteur_price: form.pvTraiteur.trim() === "" ? null : parseFloat(form.pvTraiteur) || 0,
      vat_rate: parseFloat(form.vat) || 0,
      sort_order: maxOrder + 1,
    });
    setForm({ name: "", designation: "", category: "", unit: "", pa: "", pv: "", pvTraiteur: "", vat: "", supplier: "" });
    setAdding(false);
    reload();
  }

  async function remove(p: Product) {
    if (!confirm(t("confirm_delete"))) return;
    await supabase.from("products").delete().eq("id", p.id);
    setProducts((old) => old.filter((x) => x.id !== p.id));
  }

  function downloadTemplate() {
    const blob = new Blob([buildTemplateCsv()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "modele-produits.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportMsg("");
    setImportErr(false);
    const reader = new FileReader();
    reader.onload = () => {
      const { rows, missingHeader } = parseProductsCsv(String(reader.result ?? ""));
      if (missingHeader) {
        setImportErr(true);
        setImportRows(null);
      } else {
        setImportRows(rows);
      }
    };
    reader.readAsText(file, "utf-8");
  }

  const existingNames = useMemo(
    () => new Set(products.map((p) => p.name.trim().toLowerCase())),
    [products]
  );
  const importNew = useMemo(
    () => (importRows ?? []).filter((r) => !existingNames.has(r.name.trim().toLowerCase())),
    [importRows, existingNames]
  );

  async function confirmImport() {
    if (!importNew.length) {
      setImportRows(null);
      return;
    }
    setImporting(true);
    const supplierByName = new Map(
      suppliers.map((s) => [s.name.trim().toLowerCase(), s.id])
    );
    let order = products.reduce((m, p) => Math.max(m, p.sort_order), 0);
    const payload = importNew.map((r) => ({
      supplier_id: r.supplier ? supplierByName.get(r.supplier.trim().toLowerCase()) ?? null : null,
      name: r.name,
      name_fr: r.name_fr,
      category: r.category,
      unit: r.unit,
      vat_rate: r.vat_rate,
      purchase_price: r.purchase_price,
      sale_price: r.sale_price,
      traiteur_price: r.traiteur_price,
      sort_order: ++order,
    }));
    for (let i = 0; i < payload.length; i += 100) {
      await supabase.from("products").insert(payload.slice(i, i + 100));
    }
    setImporting(false);
    setImportMsg(`${fmtNum(payload.length, lang)} ${t("import_done")}`);
    setImportRows(null);
    reload();
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("products_title")}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={onImportFile}
          />
          <button
            onClick={downloadTemplate}
            className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold hover:opacity-90"
          >
            {t("download_template")}
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold hover:opacity-90"
          >
            {t("import_csv")}
          </button>
          <button
            onClick={() => setAdding((a) => !a)}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg hover:opacity-90"
          >
            + {t("add_product")}
          </button>
        </div>
      </div>

      {importMsg && (
        <p className="mb-4 rounded-lg bg-primary/10 px-4 py-2 text-sm text-primary">{importMsg}</p>
      )}

      {importErr && (
        <p className="mb-4 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
          {t("import_bad_header")}
        </p>
      )}

      {importRows && (
        <div className="card mb-4 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{t("import_preview")}</h2>
            <button onClick={() => setImportRows(null)} className="text-sm text-muted hover:underline">
              {t("cancel")}
            </button>
          </div>
          <p className="mb-3 text-xs text-muted">{t("import_hint")}</p>
          {importRows.length === 0 ? (
            <p className="text-sm text-danger">{t("import_empty")}</p>
          ) : (
            <>
              <div className="mb-3 text-sm text-muted">
                {fmtNum(importNew.length, lang)} {t("import_new_count")}
                {importRows.length - importNew.length > 0 &&
                  ` · ${fmtNum(importRows.length - importNew.length, lang)} ${t("import_dup_skipped")}`}
              </div>
              <div className="max-h-72 overflow-auto rounded border border-border">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="sticky top-0 bg-surface text-muted">
                    <tr className="border-b border-border">
                      <th className="px-3 py-1.5 text-start font-medium">{t("product")}</th>
                      <th className="px-3 py-1.5 text-start font-medium">{t("designation_fr")}</th>
                      <th className="px-3 py-1.5 text-start font-medium">{t("category")}</th>
                      <th className="px-3 py-1.5 text-start font-medium">{t("unit")}</th>
                      <th className="px-3 py-1.5 text-start font-medium">{t("supplier")}</th>
                      <th className="px-3 py-1.5 text-end font-medium">{t("purchase_price")}</th>
                      <th className="px-3 py-1.5 text-end font-medium">{t("sale_price")}</th>
                      <th className="px-3 py-1.5 text-end font-medium">{t("vat")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {importRows.map((r, i) => {
                      const dup = existingNames.has(r.name.trim().toLowerCase());
                      return (
                        <tr key={i} className={dup ? "text-muted line-through" : ""}>
                          <td className="px-3 py-1.5">{r.name}</td>
                          <td className="px-3 py-1.5">{r.name_fr ?? "—"}</td>
                          <td className="px-3 py-1.5">{r.category ?? "—"}</td>
                          <td className="px-3 py-1.5">{r.unit ?? "—"}</td>
                          <td className="px-3 py-1.5">{r.supplier ?? "—"}</td>
                          <td className="px-3 py-1.5 text-end">{fmtNum(r.purchase_price, lang)}</td>
                          <td className="px-3 py-1.5 text-end">{fmtNum(r.sale_price, lang)}</td>
                          <td className="px-3 py-1.5 text-end">{fmtNum(r.vat_rate, lang)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <button
                onClick={confirmImport}
                disabled={importing || importNew.length === 0}
                className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg disabled:opacity-50"
              >
                {importing ? t("importing") : `${t("import_confirm")} (${fmtNum(importNew.length, lang)})`}
              </button>
            </>
          )}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="ms-auto rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
        >
          <option value="all">{t("all_categories")}</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("search")}
          className="w-48 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </div>

      {adding && (
        <div className="card mb-4 grid gap-2 p-4 sm:grid-cols-4">
          <input className="input sm:col-span-2" placeholder={t("name")} value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="input sm:col-span-2" placeholder={t("designation_fr")} value={form.designation}
            onChange={(e) => setForm({ ...form, designation: e.target.value })} />
          <input className="input" placeholder={t("category")} value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <input className="input" placeholder={t("unit")} value={form.unit}
            onChange={(e) => setForm({ ...form, unit: e.target.value })} />
          <input className="input" type="number" placeholder={t("purchase_price")} value={form.pa}
            onChange={(e) => setForm({ ...form, pa: e.target.value })} />
          <input className="input" type="number" placeholder={t("sale_price")} value={form.pv}
            onChange={(e) => setForm({ ...form, pv: e.target.value })} />
          <input className="input" type="number" placeholder={t("traiteur_price")} value={form.pvTraiteur}
            onChange={(e) => setForm({ ...form, pvTraiteur: e.target.value })} />
          <input className="input" type="number" placeholder={t("vat")} value={form.vat}
            onChange={(e) => setForm({ ...form, vat: e.target.value })} />
          <select className="input sm:col-span-2" value={form.supplier}
            onChange={(e) => setForm({ ...form, supplier: e.target.value })}>
            <option value="">{t("no_supplier")}</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <div className="flex gap-2 sm:col-span-4">
            <button onClick={addProduct} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg">
              {t("save")}
            </button>
            <button onClick={() => setAdding(false)} className="rounded-lg border border-border px-4 py-2 text-sm">
              {t("cancel")}
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        {loading ? (
          <p className="p-8 text-center text-muted">{t("loading")}</p>
        ) : (
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="px-3 py-2 text-start font-medium">{t("product")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("designation_fr")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("category")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("supplier")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("purchase_price")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("sale_price")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("traiteur_price")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("vat")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("margin")}</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((p) => {
                const margin = p.sale_price ? (p.sale_price - p.purchase_price) / p.sale_price : 0;
                return (
                  <tr key={p.id}>
                    <td className="px-3 py-2">
                      <input defaultValue={p.name} onBlur={(e) => updateField(p, "name", e.target.value)}
                        className="w-full min-w-[160px] rounded border border-transparent bg-transparent px-1 py-1 hover:border-border focus:border-primary focus:outline-none" />
                    </td>
                    <td className="px-3 py-2">
                      <input defaultValue={p.name_fr ?? ""} onBlur={(e) => updateField(p, "name_fr", e.target.value)}
                        dir="ltr" placeholder="—"
                        className="w-full min-w-[150px] rounded border border-transparent bg-transparent px-1 py-1 hover:border-border focus:border-primary focus:outline-none" />
                    </td>
                    <td className="px-3 py-2">
                      <input defaultValue={p.category ?? ""} onBlur={(e) => updateField(p, "category", e.target.value)}
                        className="w-28 rounded border border-transparent bg-transparent px-1 py-1 hover:border-border focus:border-primary focus:outline-none" />
                    </td>
                    <td className="px-3 py-2">
                      <select value={p.supplier_id ?? ""} onChange={(e) => updateField(p, "supplier_id", e.target.value)}
                        className="w-36 rounded border border-transparent bg-transparent px-1 py-1 hover:border-border focus:border-primary focus:outline-none">
                        <option value="">{t("no_supplier")}</option>
                        {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-end">
                      <input type="number" defaultValue={p.purchase_price} onBlur={(e) => updateField(p, "purchase_price", e.target.value)}
                        className="w-20 rounded border border-transparent bg-transparent px-1 py-1 text-end hover:border-border focus:border-primary focus:outline-none" />
                    </td>
                    <td className="px-3 py-2 text-end">
                      <input type="number" defaultValue={p.sale_price} onBlur={(e) => updateField(p, "sale_price", e.target.value)}
                        className="w-20 rounded border border-transparent bg-transparent px-1 py-1 text-end hover:border-border focus:border-primary focus:outline-none" />
                    </td>
                    <td className="px-3 py-2 text-end">
                      <input type="number" defaultValue={p.traiteur_price ?? ""} placeholder={t("same_as_sale_price")}
                        onBlur={(e) => updateField(p, "traiteur_price", e.target.value)}
                        className="w-20 rounded border border-transparent bg-transparent px-1 py-1 text-end hover:border-border focus:border-primary focus:outline-none" />
                    </td>
                    <td className="px-3 py-2 text-end">
                      <input type="number" defaultValue={p.vat_rate} onBlur={(e) => updateField(p, "vat_rate", e.target.value)}
                        className="w-16 rounded border border-transparent bg-transparent px-1 py-1 text-end hover:border-border focus:border-primary focus:outline-none" />
                    </td>
                    <td className="px-3 py-2 text-end text-muted">{fmtPct(margin, lang)}</td>
                    <td className="px-3 py-2 text-end">
                      <button onClick={() => remove(p)} className="text-danger hover:underline">✕</button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={10} className="p-6 text-center text-muted">{t("no_data")}</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">{fmtNum(filtered.length, lang)} {t("nav_products")}</p>
    </div>
  );
}
