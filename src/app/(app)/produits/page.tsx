"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { fmtNum, fmtPct } from "@/lib/format";
import type { Product, Seller, Supplier } from "@/lib/types";

export default function ProduitsPage() {
  const { t, lang } = useI18n();
  const supabase = useMemo(() => createClient(), []);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [sellerId, setSellerId] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", designation: "", category: "", unit: "", pa: "", pv: "", vat: "", supplier: "" });

  useEffect(() => {
    (async () => {
      const [sellersRes, suppliersRes] = await Promise.all([
        supabase.from("sellers").select("*").order("sort_order"),
        supabase.from("suppliers").select("*").order("sort_order"),
      ]);
      const list = (sellersRes.data as Seller[]) ?? [];
      setSellers(list);
      setSuppliers((suppliersRes.data as Supplier[]) ?? []);
      if (list.length) setSellerId((s) => s || list[0].id);
    })();
  }, [supabase]);

  async function reload() {
    if (!sellerId) return;
    setLoading(true);
    const { data } = await supabase
      .from("products")
      .select("*")
      .eq("seller_id", sellerId)
      .order("sort_order");
    setProducts((data as Product[]) ?? []);
    setLoading(false);
  }
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sellerId]);

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
    field: "purchase_price" | "sale_price" | "vat_rate" | "name" | "name_fr" | "category" | "supplier_id",
    value: string
  ) {
    const numeric = field === "purchase_price" || field === "sale_price" || field === "vat_rate";
    const patch: Partial<Product> = numeric
      ? { [field]: parseFloat(value) || 0 }
      : field === "supplier_id"
      ? { supplier_id: value || null }
      : { [field]: value };
    setProducts((old) => old.map((x) => (x.id === p.id ? { ...x, ...patch } : x)));
    await supabase.from("products").update(patch).eq("id", p.id);
  }

  async function addProduct() {
    if (!form.name || !sellerId) return;
    const maxOrder = products.reduce((m, p) => Math.max(m, p.sort_order), 0);
    await supabase.from("products").insert({
      seller_id: sellerId,
      supplier_id: form.supplier || null,
      name: form.name,
      name_fr: form.designation || null,
      category: form.category || null,
      unit: form.unit || null,
      purchase_price: parseFloat(form.pa) || 0,
      sale_price: parseFloat(form.pv) || 0,
      vat_rate: parseFloat(form.vat) || 0,
      sort_order: maxOrder + 1,
    });
    setForm({ name: "", designation: "", category: "", unit: "", pa: "", pv: "", vat: "", supplier: "" });
    setAdding(false);
    reload();
  }

  async function remove(p: Product) {
    if (!confirm(t("confirm_delete"))) return;
    await supabase.from("products").delete().eq("id", p.id);
    setProducts((old) => old.filter((x) => x.id !== p.id));
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("products_title")}</h1>
        <button
          onClick={() => setAdding((a) => !a)}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg hover:opacity-90"
        >
          + {t("add_product")}
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {sellers.map((s) => (
          <button
            key={s.id}
            onClick={() => setSellerId(s.id)}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${
              sellerId === s.id ? "bg-primary text-primary-fg" : "border border-border bg-surface"
            }`}
          >
            {s.name}
          </button>
        ))}
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
                <tr><td colSpan={9} className="p-6 text-center text-muted">{t("no_data")}</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">{fmtNum(filtered.length, lang)} {t("nav_products")}</p>
    </div>
  );
}
