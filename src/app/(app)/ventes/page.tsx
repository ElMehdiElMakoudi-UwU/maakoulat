"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { fmtMoney, fmtNum, sellerSalePrice, today, ttc } from "@/lib/format";
import type { Product, Seller } from "@/lib/types";

export default function VentesPageWrapper() {
  return (
    <Suspense fallback={null}>
      <VentesPage />
    </Suspense>
  );
}

function VentesPage() {
  const { t, lang } = useI18n();
  const supabase = useMemo(() => createClient(), []);
  const params = useSearchParams();

  const [sellers, setSellers] = useState<Seller[]>([]);
  const [sellerId, setSellerId] = useState<string>("");
  const [date, setDate] = useState<string>(params.get("date") || today());
  const [products, setProducts] = useState<Product[]>([]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [onlySold, setOnlySold] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [dupOpen, setDupOpen] = useState(false);
  const [dupDate, setDupDate] = useState<string>("");
  const [msg, setMsg] = useState<string>("");
  const [savedCount, setSavedCount] = useState(0);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveDate, setMoveDate] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const pendingMsg = useRef("");

  // Vendeurs
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("sellers").select("*").eq("active", true).order("sort_order");
      const list = (data as Seller[]) ?? [];
      setSellers(list);
      const wanted = params.get("seller");
      setSellerId((cur) => cur || (wanted && list.some((s) => s.id === wanted) ? wanted : list[0]?.id) || "");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  // Produits + ventes existantes
  useEffect(() => {
    if (!sellerId) return;
    setLoading(true);
    setMsg(pendingMsg.current);
    pendingMsg.current = "";
    setMoveOpen(false);
    (async () => {
      const [{ data: prods }, { data: sales }] = await Promise.all([
        supabase.from("products").select("*").eq("active", true).order("sort_order"),
        supabase.from("sales").select("product_id, quantity").eq("seller_id", sellerId).eq("sale_date", date),
      ]);
      setProducts((prods as Product[]) ?? []);
      const q: Record<string, string> = {};
      for (const s of (sales as { product_id: string; quantity: number }[]) ?? []) {
        if (s.quantity) q[s.product_id] = String(s.quantity);
      }
      setQty(q);
      setSavedCount(Object.keys(q).length);
      setLoading(false);
    })();
  }, [supabase, sellerId, date]);

  const seller = useMemo(() => sellers.find((s) => s.id === sellerId), [sellers, sellerId]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return products.filter((p) => {
      if (onlySold && !((parseFloat(qty[p.id] || "0") || 0) > 0)) return false;
      if (s && !(p.name.toLowerCase().includes(s) || (p.category ?? "").toLowerCase().includes(s))) return false;
      return true;
    });
  }, [products, search, onlySold, qty]);

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
    let ca = 0, profit = 0, items = 0;
    const kind = seller?.kind ?? "retail";
    for (const p of products) {
      const q = parseFloat(qty[p.id] || "0") || 0;
      if (q > 0) {
        const price = sellerSalePrice(p, kind);
        ca += q * ttc(price, p.vat_rate);
        profit += q * (price - p.purchase_price);
        items += q;
      }
    }
    return { ca, profit, items };
  }, [products, qty, seller]);

  const soldCount = useMemo(
    () => products.filter((p) => (parseFloat(qty[p.id] || "0") || 0) > 0).length,
    [products, qty]
  );

  function bump(id: string, delta: number) {
    setQty((old) => {
      const cur = parseFloat(old[id] || "0") || 0;
      const next = Math.max(0, cur + delta);
      const copy = { ...old };
      if (next === 0) delete copy[id];
      else copy[id] = String(next);
      return copy;
    });
  }

  async function copyFrom() {
    if (!dupDate || !sellerId) return;
    const { data } = await supabase
      .from("sales")
      .select("product_id, quantity")
      .eq("seller_id", sellerId)
      .eq("sale_date", dupDate);
    const rows = (data as { product_id: string; quantity: number }[]) ?? [];
    if (!rows.length) {
      setMsg(t("copy_empty"));
      return;
    }
    const q: Record<string, string> = {};
    for (const r of rows) if (r.quantity) q[r.product_id] = String(r.quantity);
    setQty(q);
    setDupOpen(false);
    setMsg(t("copy_done"));
  }

  async function save() {
    if (!sellerId) return;
    setSaving(true);
    const kind = seller?.kind ?? "retail";
    const toUpsert = products
      .filter((p) => (parseFloat(qty[p.id] || "0") || 0) > 0)
      .map((p) => ({
        product_id: p.id, seller_id: sellerId, sale_date: date,
        quantity: parseFloat(qty[p.id]), purchase_price: p.purchase_price, sale_price: sellerSalePrice(p, kind),
      }));
    const zeroIds = products.filter((p) => !((parseFloat(qty[p.id] || "0") || 0) > 0)).map((p) => p.id);
    if (toUpsert.length) await supabase.from("sales").upsert(toUpsert, { onConflict: "product_id,seller_id,sale_date" });
    if (zeroIds.length) await supabase.from("sales").delete().eq("seller_id", sellerId).eq("sale_date", date).in("product_id", zeroIds);
    setSavedCount(toUpsert.length);
    setSaving(false);
    setSavedAt(Date.now());
    setMsg("");
    setTimeout(() => setSavedAt(null), 2500);
  }

  // Déplace les ventes enregistrées du jour vers une autre date (fusion si la date cible a déjà des ventes)
  async function moveDay() {
    if (!sellerId || !moveDate) return;
    if (moveDate === date) { setMsg(t("move_same_date")); return; }
    const [{ data: src }, { data: dst }] = await Promise.all([
      supabase.from("sales").select("id, product_id, quantity").eq("seller_id", sellerId).eq("sale_date", date),
      supabase.from("sales").select("id, product_id, quantity").eq("seller_id", sellerId).eq("sale_date", moveDate),
    ]);
    type Row = { id: string; product_id: string; quantity: number };
    const srcRows = (src as Row[]) ?? [];
    const dstRows = (dst as Row[]) ?? [];
    if (!srcRows.length) { setMsg(t("copy_empty")); return; }
    if (dstRows.length && !confirm(t("move_confirm_merge").replace("{date}", moveDate))) return;
    setBusy(true);
    const dstByProduct = new Map(dstRows.map((r) => [r.product_id, r]));
    const plain = srcRows.filter((r) => !dstByProduct.has(r.product_id));
    const merged = srcRows.filter((r) => dstByProduct.has(r.product_id));
    let error = null;
    for (const r of merged) {
      const d = dstByProduct.get(r.product_id)!;
      const res = await supabase.from("sales").update({ quantity: Number(d.quantity) + Number(r.quantity) }).eq("id", d.id);
      error ||= res.error;
    }
    if (merged.length) error ||= (await supabase.from("sales").delete().in("id", merged.map((r) => r.id))).error;
    if (plain.length) error ||= (await supabase.from("sales").update({ sale_date: moveDate }).in("id", plain.map((r) => r.id))).error;
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    setMoveOpen(false);
    pendingMsg.current = t("move_done").replace("{date}", moveDate);
    setDate(moveDate);
  }

  async function deleteDay() {
    if (!sellerId) return;
    if (!confirm(t("delete_day_confirm").replace("{seller}", seller?.name ?? "").replace("{date}", date))) return;
    setBusy(true);
    const { error } = await supabase.from("sales").delete().eq("seller_id", sellerId).eq("sale_date", date);
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    setQty({});
    setSavedCount(0);
    setMsg(t("delete_day_done"));
  }

  return (
    <div className="pb-28">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">{t("sales_entry_title")}</h1>
        <p className="text-sm text-muted">{t("sales_hint")}</p>
      </div>

      {/* Sélecteurs */}
      <div className="card mb-3 flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[140px] flex-1">
          <label className="mb-1 block text-xs font-medium text-muted">{t("seller")}</label>
          <div className="flex flex-wrap gap-1.5">
            {sellers.map((s) => (
              <button key={s.id} onClick={() => setSellerId(s.id)}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                  sellerId === s.id ? "bg-primary text-primary-fg" : "border border-border bg-surface hover:bg-background"
                }`}>
                {s.name}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">{t("date")}</label>
          <div className="flex gap-1.5">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="rounded-lg border border-border bg-surface px-3 py-2 outline-none focus:border-primary" />
            <button onClick={() => setDate(today())}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:bg-background">
              {t("today_btn")}
            </button>
          </div>
        </div>
      </div>

      {/* Barre d'outils */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-sm">
          <button onClick={() => setOnlySold(false)}
            className={`rounded-md px-3 py-1.5 font-medium ${!onlySold ? "bg-primary text-primary-fg" : "text-muted"}`}>
            {t("filter_all")}
          </button>
          <button onClick={() => setOnlySold(true)}
            className={`rounded-md px-3 py-1.5 font-medium ${onlySold ? "bg-primary text-primary-fg" : "text-muted"}`}>
            {t("filter_sold")} {soldCount > 0 && `(${soldCount})`}
          </button>
        </div>
        <button onClick={() => { setDupOpen((o) => !o); setDupDate(""); }}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm hover:bg-background">
          📋 {t("duplicate_day")}
        </button>
        {savedCount > 0 && (
          <>
            <button onClick={() => { setMoveOpen((o) => !o); setMoveDate(""); }} disabled={busy}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm hover:bg-background disabled:opacity-50">
              📅 {t("move_day")}
            </button>
            <button onClick={deleteDay} disabled={busy}
              className="rounded-lg border border-danger/40 bg-surface px-3 py-1.5 text-sm text-danger hover:bg-danger/10 disabled:opacity-50">
              🗑 {t("delete_day")}
            </button>
          </>
        )}
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("search")}
          className="ms-auto w-40 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary sm:w-56" />
      </div>

      {dupOpen && (
        <div className="card mb-3 flex flex-wrap items-center gap-2 p-3">
          <span className="text-sm">{t("copy_from_date")}</span>
          <input type="date" value={dupDate} onChange={(e) => setDupDate(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm" />
          <button onClick={copyFrom} disabled={!dupDate}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-fg disabled:opacity-50">
            {t("copy")}
          </button>
        </div>
      )}

      {moveOpen && (
        <div className="card mb-3 flex flex-wrap items-center gap-2 p-3">
          <span className="text-sm">{t("move_to_date")}</span>
          <input type="date" value={moveDate} onChange={(e) => setMoveDate(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm" />
          <button onClick={moveDay} disabled={!moveDate || busy}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-fg disabled:opacity-50">
            {t("move")}
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
              <div className="border-b border-border bg-background px-4 py-2 text-sm font-bold text-primary">{cat}</div>
              <div className="divide-y divide-border">
                {items.map((p) => {
                  const q = parseFloat(qty[p.id] || "0") || 0;
                  const price = sellerSalePrice(p, seller?.kind ?? "retail");
                  return (
                    <div key={p.id} className={`flex items-center gap-2 px-3 py-2.5 ${q > 0 ? "bg-primary/5" : ""}`}>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{p.name}</div>
                        <div className="text-xs text-muted">
                          {fmtNum(ttc(price, p.vat_rate), lang)} {t("currency")} TTC
                          {q > 0 && ` · ${fmtMoney(q * ttc(price, p.vat_rate), lang)}`}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => bump(p.id, -1)} disabled={q <= 0}
                          className="h-10 w-10 rounded-lg border border-border bg-surface text-xl font-bold text-muted hover:bg-background disabled:opacity-40">
                          −
                        </button>
                        <input type="number" inputMode="decimal" min={0} value={qty[p.id] ?? ""}
                          onChange={(e) => setQty((old) => {
                            const v = e.target.value;
                            const copy = { ...old };
                            if (!v || parseFloat(v) === 0) delete copy[p.id]; else copy[p.id] = v;
                            return copy;
                          })}
                          placeholder="0"
                          className={`w-16 rounded-lg border py-2 text-center outline-none focus:border-primary ${
                            q > 0 ? "border-primary font-semibold" : "border-border bg-surface"
                          }`} />
                        <button onClick={() => bump(p.id, 1)}
                          className="h-10 w-10 rounded-lg bg-primary text-xl font-bold text-primary-fg hover:opacity-90">
                          +
                        </button>
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
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur md:ms-60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-1 p-3 md:px-6">
          <div>
            <div className="text-xs text-muted">{t("ca")}</div>
            <div className="text-lg font-bold text-primary">{fmtMoney(totals.ca, lang)}</div>
          </div>
          <div>
            <div className="text-xs text-muted">{t("profit")}</div>
            <div className="text-lg font-bold text-success">{fmtMoney(totals.profit, lang)}</div>
          </div>
          <div className="hidden sm:block">
            <div className="text-xs text-muted">{t("items_sold")}</div>
            <div className="text-lg font-semibold">{fmtNum(totals.items, lang)}</div>
          </div>
          <button onClick={save} disabled={saving}
            className="ms-auto rounded-lg bg-primary px-6 py-2.5 font-semibold text-primary-fg transition hover:opacity-90 disabled:opacity-60">
            {saving ? t("saving") : savedAt ? t("saved") : t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}
