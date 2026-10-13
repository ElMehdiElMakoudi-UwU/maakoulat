"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { fmtMoney, fmtNum, today } from "@/lib/format";
import type { InventoryCount, Product } from "@/lib/types";

type Filter = "all" | "counted" | "not_counted";
type PastCount = { date: string; value: number; lines: number };

// La catégorie « Traiteur » n'est qu'une liste de prix, pas du stock physique
const isStockProduct = (p: Product) => p.category?.trim().toLowerCase() !== "traiteur";

export default function InventairePage() {
  const { t, lang } = useI18n();
  const supabase = useMemo(() => createClient(), []);

  const [date, setDate] = useState<string>(today());
  const [products, setProducts] = useState<Product[]>([]);
  const [qty, setQty] = useState<Record<string, string>>({});
  // Prix d'achat figés des lignes déjà enregistrées pour cette date
  const [savedCost, setSavedCost] = useState<Record<string, number>>({});
  const [past, setPast] = useState<PastCount[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyDate, setCopyDate] = useState("");
  const [msg, setMsg] = useState("");

  async function loadPast() {
    const { data } = await supabase.from("inventory_counts").select("count_date, quantity, unit_cost");
    const map = new Map<string, PastCount>();
    for (const r of (data as Pick<InventoryCount, "count_date" | "quantity" | "unit_cost">[]) ?? []) {
      const cur = map.get(r.count_date) ?? { date: r.count_date, value: 0, lines: 0 };
      cur.value += Number(r.quantity) * Number(r.unit_cost);
      cur.lines += 1;
      map.set(r.count_date, cur);
    }
    setPast(Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date)));
  }

  useEffect(() => {
    loadPast();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  // Produits + inventaire existant pour la date
  useEffect(() => {
    setLoading(true);
    setMsg("");
    (async () => {
      const [{ data: prods }, { data: rows }] = await Promise.all([
        supabase.from("products").select("*").eq("active", true).order("sort_order"),
        supabase.from("inventory_counts").select("*").eq("count_date", date),
      ]);
      setProducts(((prods as Product[]) ?? []).filter(isStockProduct));
      const q: Record<string, string> = {};
      const c: Record<string, number> = {};
      for (const r of (rows as InventoryCount[]) ?? []) {
        q[r.product_id] = String(Number(r.quantity));
        c[r.product_id] = Number(r.unit_cost);
      }
      setQty(q);
      setSavedCost(c);
      setDirty(false);
      setLoading(false);
    })();
  }, [supabase, date]);

  const unitCost = (p: Product) => savedCost[p.id] ?? Number(p.purchase_price);
  const isCounted = (id: string) => qty[id] !== undefined && qty[id] !== "";

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return products.filter((p) => {
      if (filter === "counted" && !isCounted(p.id)) return false;
      if (filter === "not_counted" && isCounted(p.id)) return false;
      if (
        s &&
        !(
          p.name.toLowerCase().includes(s) ||
          (p.name_fr ?? "").toLowerCase().includes(s) ||
          (p.category ?? "").toLowerCase().includes(s)
        )
      )
        return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, search, filter, qty]);

  const grouped = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of filtered) {
      const cat = p.category || "—";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(p);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const totals = useMemo(() => {
    let value = 0, counted = 0;
    const byCat = new Map<string, number>();
    for (const p of products) {
      if (!isCounted(p.id)) continue;
      const v = (parseFloat(qty[p.id]) || 0) * unitCost(p);
      value += v;
      counted += 1;
      const cat = p.category || "—";
      byCat.set(cat, (byCat.get(cat) ?? 0) + v);
    }
    return { value, counted, byCat };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, qty, savedCost]);

  function setQuantity(id: string, v: string) {
    setQty((old) => {
      const copy = { ...old };
      if (v === "") delete copy[id];
      else copy[id] = v;
      return copy;
    });
    setDirty(true);
  }

  async function copyFrom() {
    if (!copyDate) return;
    const { data } = await supabase
      .from("inventory_counts")
      .select("product_id, quantity")
      .eq("count_date", copyDate);
    const rows = (data as Pick<InventoryCount, "product_id" | "quantity">[]) ?? [];
    const q: Record<string, string> = {};
    for (const r of rows) q[r.product_id] = String(Number(r.quantity));
    setQty(q);
    setDirty(true);
    setCopyOpen(false);
    setMsg(t("stock_copy_done"));
  }

  async function save() {
    setSaving(true);
    // Un produit laissé vide = non compté (pas de ligne) ; « 0 » = compté, stock nul.
    const toUpsert = products
      .filter((p) => isCounted(p.id))
      .map((p) => ({
        count_date: date,
        product_id: p.id,
        quantity: parseFloat(qty[p.id]) || 0,
        unit_cost: unitCost(p),
      }));
    const removedIds = Object.keys(savedCost).filter((id) => !isCounted(id));
    if (toUpsert.length)
      await supabase.from("inventory_counts").upsert(toUpsert, { onConflict: "count_date,product_id" });
    if (removedIds.length)
      await supabase.from("inventory_counts").delete().eq("count_date", date).in("product_id", removedIds);
    setSavedCost(Object.fromEntries(toUpsert.map((r) => [r.product_id, r.unit_cost])));
    setSaving(false);
    setDirty(false);
    setMsg("");
    setSavedAt(Date.now());
    setTimeout(() => setSavedAt(null), 2500);
    loadPast();
  }

  async function removeCount() {
    if (!confirm(t("confirm_delete"))) return;
    await supabase.from("inventory_counts").delete().eq("count_date", date);
    setQty({});
    setSavedCost({});
    setDirty(false);
    loadPast();
  }

  const hasSaved = Object.keys(savedCost).length > 0;
  const fmtDate = (d: string) =>
    new Intl.DateTimeFormat(lang === "ar" ? "ar-MA" : "fr-FR", { dateStyle: "medium" }).format(
      new Date(d + "T00:00:00")
    );

  return (
    <div className="pb-28">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("stock_title")}</h1>
          <p className="text-sm text-muted">{t("stock_hint")}</p>
        </div>
        <button onClick={() => window.print()}
          className="no-print rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:bg-background">
          🖨️ {t("stock_print")}
        </button>
      </div>

      <div className="mb-3 grid gap-3 md:grid-cols-3">
        {/* Date */}
        <div className="card p-4">
          <label className="mb-1 block text-xs font-medium text-muted">{t("stock_date")}</label>
          <div className="flex gap-1.5">
            <input type="date" value={date}
              onChange={(e) => {
                if (e.target.value && (!dirty || confirm(t("stock_unsaved") + " — OK ?"))) setDate(e.target.value);
              }}
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 outline-none focus:border-primary" />
            <button onClick={() => (!dirty || confirm(t("stock_unsaved") + " — OK ?")) && setDate(today())}
              className="no-print rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:bg-background">
              {t("today_btn")}
            </button>
          </div>
          <p className="mt-2 text-sm capitalize">{fmtDate(date)}</p>
        </div>

        {/* Inventaires précédents */}
        <div className="card no-print p-4 md:col-span-2">
          <div className="mb-2 text-xs font-medium text-muted">{t("stock_previous")}</div>
          {past.length === 0 ? (
            <p className="text-sm text-muted">{t("stock_none_yet")}</p>
          ) : (
            <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
              {past.map((c) => (
                <button key={c.date}
                  onClick={() => (!dirty || confirm(t("stock_unsaved") + " — OK ?")) && setDate(c.date)}
                  className={`rounded-lg px-3 py-1.5 text-start text-sm transition ${
                    c.date === date ? "bg-primary text-primary-fg" : "border border-border bg-surface hover:bg-background"
                  }`}>
                  <div className="font-medium">{fmtDate(c.date)}</div>
                  <div className={`text-xs ${c.date === date ? "opacity-80" : "text-muted"}`}>
                    {fmtMoney(c.value, lang)} · {c.lines}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Barre d'outils */}
      <div className="no-print mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-sm">
          {(["all", "counted", "not_counted"] as Filter[]).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1.5 font-medium ${filter === f ? "bg-primary text-primary-fg" : "text-muted"}`}>
              {f === "all" ? t("filter_all") : f === "counted" ? t("stock_counted") : t("stock_not_counted")}
              {f === "counted" && totals.counted > 0 && ` (${totals.counted})`}
              {f === "not_counted" && ` (${products.length - totals.counted})`}
            </button>
          ))}
        </div>
        {past.some((c) => c.date !== date) && (
          <button onClick={() => { setCopyOpen((o) => !o); setCopyDate(""); }}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm hover:bg-background">
            📋 {t("stock_start_from")}
          </button>
        )}
        {hasSaved && (
          <button onClick={removeCount}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-danger hover:bg-background">
            ✕ {t("stock_delete")}
          </button>
        )}
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("search")}
          className="ms-auto w-40 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary sm:w-56" />
      </div>

      {copyOpen && (
        <div className="card no-print mb-3 flex flex-wrap items-center gap-2 p-3">
          <span className="text-sm">{t("stock_start_from_label")}</span>
          <select value={copyDate} onChange={(e) => setCopyDate(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm">
            <option value="">—</option>
            {past.filter((c) => c.date !== date).map((c) => (
              <option key={c.date} value={c.date}>{fmtDate(c.date)}</option>
            ))}
          </select>
          <button onClick={copyFrom} disabled={!copyDate}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-fg disabled:opacity-50">
            {t("copy")}
          </button>
        </div>
      )}

      {msg && <p className="mb-3 rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent">{msg}</p>}

      {loading ? (
        <p className="p-8 text-center text-muted">{t("loading")}</p>
      ) : (
        <div className="space-y-5">
          {grouped.map(([cat, items]) => (
            <div key={cat} className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-border bg-background px-4 py-2 text-sm font-bold">
                <span className="text-primary">{cat}</span>
                {(totals.byCat.get(cat) ?? 0) > 0 && <span>{fmtMoney(totals.byCat.get(cat)!, lang)}</span>}
              </div>
              <div className="divide-y divide-border">
                {items.map((p) => {
                  const counted = isCounted(p.id);
                  const cost = unitCost(p);
                  const frozen = savedCost[p.id] !== undefined && savedCost[p.id] !== Number(p.purchase_price);
                  const value = (parseFloat(qty[p.id]) || 0) * cost;
                  return (
                    <div key={p.id} className={`flex items-center gap-3 px-3 py-2.5 ${counted ? "bg-primary/5" : ""}`}>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{p.name}</div>
                        <div className="text-xs text-muted">
                          {p.name_fr && <span>{p.name_fr} · </span>}
                          <span
                            className={frozen ? "text-accent" : undefined}
                            title={frozen ? t("stock_cost_frozen").replace("{price}", fmtMoney(p.purchase_price, lang)) : undefined}>
                            {t("stock_unit_cost")} {fmtMoney(cost, lang)}
                            {p.unit && ` / ${p.unit}`}
                            {frozen && " *"}
                          </span>
                        </div>
                      </div>
                      <input type="number" inputMode="decimal" min={0} step="any" value={qty[p.id] ?? ""}
                        onChange={(e) => setQuantity(p.id, e.target.value)}
                        placeholder="—"
                        className={`w-24 rounded-lg border py-2 text-center outline-none focus:border-primary ${
                          counted ? "border-primary font-semibold" : "border-border bg-surface"
                        }`} />
                      <div className="w-24 text-end text-sm font-semibold sm:w-28">
                        {counted ? fmtMoney(value, lang) : <span className="text-muted">—</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {grouped.length === 0 && <p className="p-8 text-center text-muted">{t("no_data")}</p>}
        </div>
      )}

      {/* Barre de total fixe */}
      <div className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur md:ms-60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-1 p-3 md:px-6">
          <div>
            <div className="text-xs text-muted">{t("stock_total_value")}</div>
            <div className="text-lg font-bold text-primary">{fmtMoney(totals.value, lang)}</div>
          </div>
          <div>
            <div className="text-xs text-muted">{t("stock_products_counted")}</div>
            <div className="text-lg font-semibold">
              {fmtNum(totals.counted, lang)} / {fmtNum(products.length, lang)}
            </div>
          </div>
          {dirty && <span className="text-xs text-accent">● {t("stock_unsaved")}</span>}
          <button onClick={save} disabled={saving}
            className="ms-auto rounded-lg bg-primary px-6 py-2.5 font-semibold text-primary-fg transition hover:opacity-90 disabled:opacity-60">
            {saving ? t("saving") : savedAt ? t("saved") : t("save")}
          </button>
        </div>
      </div>

      {/* Total à l'impression (la barre fixe est masquée) */}
      <div className="card mt-5 hidden p-4 text-end text-lg font-bold print:block">
        {t("stock_total_value")} : {fmtMoney(totals.value, lang)}
      </div>
    </div>
  );
}
