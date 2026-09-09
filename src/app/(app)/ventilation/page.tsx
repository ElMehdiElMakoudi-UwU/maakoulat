"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { currentMonth, fmtMoney, fmtNum, monthLabel, monthRange } from "@/lib/format";
import type { Client } from "@/lib/types";

interface SaleRow {
  product_id: string;
  quantity: number;
  sale_price: number;
  products:
    | { name: string; name_fr: string | null; vat_rate: number; unit: string | null }
    | { name: string; name_fr: string | null; vat_rate: number; unit: string | null }[]
    | null;
}
interface PoolLine {
  product_id: string;
  name: string;
  unit: string | null;
  vat: number;
  qty: number;
  pu: number;
  ttc: number;
}

export default function VentilationPage() {
  const { t, lang } = useI18n();
  const supabase = useMemo(() => createClient(), []);

  const [month, setMonth] = useState(currentMonth());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState(false);

  const [clients, setClients] = useState<Client[]>([]);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [bankEnc, setBankEnc] = useState(0);

  const [autoEnc, setAutoEnc] = useState(true);
  const [encInput, setEncInput] = useState("");
  const [note, setNote] = useState("");
  const [targets, setTargets] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const { start, end } = monthRange(month);
    const [cliRes, salesRes, encRes, ventRes, tgtRes] = await Promise.all([
      supabase.from("clients").select("*").order("sort_order"),
      supabase
        .from("sales")
        .select("product_id, quantity, sale_price, products(name, name_fr, vat_rate, unit)")
        .gte("sale_date", start)
        .lt("sale_date", end),
      supabase
        .from("bank_transactions")
        .select("amount")
        .eq("kind", "encaissement")
        .gte("op_date", start)
        .lt("op_date", end),
      supabase.from("monthly_ventilation").select("*").eq("month", month).maybeSingle(),
      supabase.from("ventilation_targets").select("*").eq("month", month),
    ]);

    setClients((cliRes.data as Client[]) ?? []);
    setSales((salesRes.data as SaleRow[]) ?? []);
    const enc = ((encRes.data as { amount: number }[]) ?? []).reduce((s, r) => s + Number(r.amount), 0);
    setBankEnc(enc);

    const vent = ventRes.data as
      | { encaissement_total: number; auto_encaissement: boolean; note: string | null }
      | null;
    setAutoEnc(vent ? vent.auto_encaissement : true);
    setEncInput(vent && !vent.auto_encaissement ? String(vent.encaissement_total) : "");
    setNote(vent?.note ?? "");

    const tgt: Record<string, string> = {};
    for (const r of (tgtRes.data as { client_id: string; target_ttc: number }[]) ?? [])
      tgt[r.client_id] = String(r.target_ttc);
    setTargets(tgt);

    setLoading(false);
  }, [supabase, month]);

  useEffect(() => {
    load();
  }, [load]);

  // ---------- Pool (produits vendus ce mois) ----------
  const pool = useMemo<PoolLine[]>(() => {
    const map = new Map<string, PoolLine>();
    for (const s of sales) {
      const p = Array.isArray(s.products) ? s.products[0] : s.products;
      const qty = Number(s.quantity) || 0;
      const price = Number(s.sale_price) || 0;
      const vat = Number(p?.vat_rate) || 0;
      const key = s.product_id;
      const cur =
        map.get(key) ??
        ({
          product_id: key,
          name: p?.name_fr || p?.name || "—",
          unit: p?.unit ?? null,
          vat,
          qty: 0,
          pu: 0,
          ttc: 0,
        } as PoolLine);
      cur.qty += qty;
      cur.ttc += qty * price * (1 + vat / 100);
      cur.pu += qty * price; // provisoire : somme HT, converti après
      map.set(key, cur);
    }
    const list = Array.from(map.values()).map((l) => ({
      ...l,
      pu: l.qty ? l.pu / l.qty : 0,
    }));
    return list.sort((a, b) => b.ttc - a.ttc);
  }, [sales]);

  const poolTTC = useMemo(() => pool.reduce((s, l) => s + l.ttc, 0), [pool]);

  const encaissement = autoEnc ? bankEnc : parseFloat(encInput) || 0;

  const invoiceClients = useMemo(
    () => clients.filter((c) => c.active && c.wants_invoice),
    [clients]
  );

  const totalInvoiced = useMemo(
    () => invoiceClients.reduce((s, c) => s + (parseFloat(targets[c.id]) || 0), 0),
    [invoiceClients, targets]
  );
  const comptant = encaissement - totalInvoiced;

  async function save() {
    setSaving(true);
    try {
      await supabase.from("monthly_ventilation").upsert(
        {
          month,
          encaissement_total: encaissement,
          auto_encaissement: autoEnc,
          note: note.trim() || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "month" }
      );
      const rows = invoiceClients.map((c) => ({
        month,
        client_id: c.id,
        target_ttc: parseFloat(targets[c.id]) || 0,
      }));
      if (rows.length)
        await supabase.from("ventilation_targets").upsert(rows, { onConflict: "month,client_id" });
      setFlash(true);
      setTimeout(() => setFlash(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("ventilation_title")}</h1>
          <p className="max-w-xl text-sm text-muted">{t("ventilation_hint")}</p>
        </div>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2 outline-none focus:border-primary"
        />
      </div>

      {loading ? (
        <p className="p-8 text-center text-muted">{t("loading")}</p>
      ) : (
        <>
          <p className="mb-3 text-sm capitalize text-muted">{monthLabel(month, lang)}</p>

          {/* ---------- KPIs ---------- */}
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="card p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs text-muted">{t("vt_encaissement")}</span>
                <label className="flex items-center gap-1 text-[11px] text-muted">
                  <input
                    type="checkbox"
                    checked={autoEnc}
                    onChange={(e) => setAutoEnc(e.target.checked)}
                  />
                  {t("vt_auto")}
                </label>
              </div>
              {autoEnc ? (
                <>
                  <div className="text-xl font-bold text-success">{fmtMoney(bankEnc, lang)}</div>
                  <div className="text-[11px] text-muted">
                    {bankEnc ? t("vt_from_bank") : t("vt_no_bank")}
                  </div>
                </>
              ) : (
                <input
                  type="number"
                  value={encInput}
                  onChange={(e) => setEncInput(e.target.value)}
                  placeholder="0"
                  className="input mt-1"
                  dir="ltr"
                />
              )}
            </div>

            <div className="card p-3">
              <div className="text-xs text-muted">{t("vt_pool")}</div>
              <div className="text-xl font-bold">{fmtMoney(poolTTC, lang)}</div>
              <div className="text-[11px] text-muted">
                {fmtNum(pool.length, lang)} {t("nb_products")}
              </div>
            </div>

            <div className="card p-3">
              <div className="text-xs text-muted">{t("vt_gap")}</div>
              <div
                className={`text-xl font-bold ${
                  Math.abs(encaissement - poolTTC) < 1 ? "text-muted" : "text-accent"
                }`}
              >
                {fmtMoney(encaissement - poolTTC, lang)}
              </div>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-5">
            {/* ---------- Pool ---------- */}
            <div className="lg:col-span-3">
              <h2 className="mb-2 font-bold">{t("vt_pool_table")}</h2>
              <div className="card overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted">
                      <th className="px-3 py-2 text-start font-medium">{t("product")}</th>
                      <th className="px-3 py-2 text-end font-medium">{t("vt_qty_sold")}</th>
                      <th className="px-3 py-2 text-end font-medium">{t("vt_pu")}</th>
                      <th className="px-3 py-2 text-end font-medium">{t("vat")}</th>
                      <th className="px-3 py-2 text-end font-medium">{t("vt_line_ttc")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {pool.map((l) => (
                      <tr key={l.product_id}>
                        <td className="px-3 py-1.5">
                          {l.name}
                          {l.unit ? <span className="text-xs text-muted"> · {l.unit}</span> : null}
                        </td>
                        <td className="px-3 py-1.5 text-end">{fmtNum(l.qty, lang)}</td>
                        <td className="px-3 py-1.5 text-end">{fmtMoney(l.pu, lang)}</td>
                        <td className="px-3 py-1.5 text-end">{l.vat ? `${fmtNum(l.vat, lang)}%` : "0%"}</td>
                        <td className="px-3 py-1.5 text-end font-medium">{fmtMoney(l.ttc, lang)}</td>
                      </tr>
                    ))}
                    {pool.length === 0 && (
                      <tr>
                        <td colSpan={5} className="p-6 text-center text-muted">
                          {t("vt_no_sales")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {pool.length > 0 && (
                    <tfoot>
                      <tr className="border-t-2 border-border bg-background font-bold">
                        <td className="px-3 py-2" colSpan={4}>
                          {t("total")}
                        </td>
                        <td className="px-3 py-2 text-end">{fmtMoney(poolTTC, lang)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            {/* ---------- Ventilation ---------- */}
            <div className="lg:col-span-2">
              <h2 className="mb-2 font-bold">{t("vt_targets")}</h2>
              <div className="card p-4">
                {invoiceClients.length === 0 ? (
                  <p className="text-sm text-muted">{t("vt_no_invoice_clients")}</p>
                ) : (
                  <div className="space-y-2">
                    {invoiceClients.map((c) => (
                      <div key={c.id} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm" title={c.name}>
                          {c.name}
                          {c.discount_rate ? (
                            <span className="text-xs text-muted"> (−{fmtNum(c.discount_rate, lang)}%)</span>
                          ) : null}
                        </span>
                        <input
                          type="number"
                          value={targets[c.id] ?? ""}
                          onChange={(e) => setTargets((o) => ({ ...o, [c.id]: e.target.value }))}
                          placeholder="0"
                          dir="ltr"
                          className="input w-32 text-end"
                        />
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-3 space-y-1.5 border-t border-border pt-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted">{t("vt_total_invoiced")}</span>
                    <span className="font-semibold">{fmtMoney(totalInvoiced, lang)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-bold">{t("vt_comptant")}</span>
                    <span className={`text-lg font-bold ${comptant < 0 ? "text-danger" : "text-success"}`}>
                      {fmtMoney(comptant, lang)}
                    </span>
                  </div>
                  {comptant < 0 && <p className="text-xs text-danger">{t("vt_over")}</p>}
                </div>

                <textarea
                  className="input mt-3"
                  rows={2}
                  placeholder={t("note")}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />

                <button
                  onClick={save}
                  disabled={saving}
                  className="mt-3 w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg disabled:opacity-50"
                >
                  {flash ? t("vt_saved") : saving ? t("saving") : t("save")}
                </button>
                <p className="mt-2 text-center text-[11px] text-muted">{t("vt_next_step")}</p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
