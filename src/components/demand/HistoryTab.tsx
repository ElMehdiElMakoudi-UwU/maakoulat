"use client";

import { useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { currentMonth, fmtNum, monthLabel, monthRange } from "@/lib/format";
import { downloadFile } from "@/lib/csv";
import { buildXlsx, readXlsx } from "@/lib/xlsx";
import {
  buildHistoryTemplate,
  csvToSheet,
  normLabel,
  parseHistorySheets,
  productMatcher,
  type HistoryParseResult,
} from "@/lib/historyImport";
import type { DemandState } from "@/lib/demandData";
import type { SalesHistory, SellerKind } from "@/lib/types";

type SetState = React.Dispatch<React.SetStateAction<DemandState | null>>;

function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const lastDayOf = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

export default function HistoryTab({ state, reload }: { state: DemandState; setState: SetState; reload: () => Promise<void> }) {
  const { t, lang } = useI18n();
  const supabase = useMemo(() => createClient(), []);
  const activeProducts = useMemo(() => state.products.filter((p) => p.active), [state.products]);
  const fileRef = useRef<HTMLInputElement>(null);

  // ---------------- Import ----------------
  const [parsed, setParsed] = useState<HistoryParseResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState("");

  async function downloadTemplate() {
    const blob = await buildXlsx(buildHistoryTemplate(activeProducts, prevMonth(currentMonth())));
    downloadFile("modele-historique-ventes.xlsx", blob);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMsg("");
    try {
      const sheets = /\.csv$/i.test(file.name)
        ? [csvToSheet(await file.text())]
        : await readXlsx(await file.arrayBuffer());
      setParsed(parseHistorySheets(sheets));
      setMapping({});
    } catch {
      setParsed({ rows: [], errors: [], recognized: false });
    }
  }

  const match = useMemo(() => productMatcher(state.products), [state.products]);

  const preview = useMemo(() => {
    if (!parsed) return null;
    const unmatched = new Map<string, number>();
    let matched = 0;
    let from = "";
    let to = "";
    for (const r of parsed.rows) {
      if (match(r.label)) matched++;
      else unmatched.set(r.label, (unmatched.get(r.label) ?? 0) + 1);
      if (!from || r.start < from) from = r.start;
      if (!to || r.end > to) to = r.end;
    }
    return { matched, unmatched: Array.from(unmatched.entries()), from, to };
  }, [parsed, match]);

  async function confirmImport() {
    if (!parsed) return;
    setImporting(true);
    // Agrège les doublons (même produit / type / période) avant l'upsert
    const agg = new Map<string, { product_id: string; seller_kind: SellerKind; period_start: string; period_end: string; quantity: number }>();
    for (const r of parsed.rows) {
      const pid = match(r.label) ?? mapping[normLabel(r.label)];
      if (!pid) continue;
      const key = `${pid}|${r.kind}|${r.start}|${r.end}`;
      const cur = agg.get(key);
      if (cur) cur.quantity += r.quantity;
      else agg.set(key, { product_id: pid, seller_kind: r.kind, period_start: r.start, period_end: r.end, quantity: r.quantity });
    }
    const payload = Array.from(agg.values());
    for (let i = 0; i < payload.length; i += 500) {
      const { error } = await supabase
        .from("sales_history")
        .upsert(payload.slice(i, i + 500), { onConflict: "product_id,seller_kind,period_start,period_end" });
      if (error) {
        setImporting(false);
        return alert(error.message);
      }
    }
    setImporting(false);
    setParsed(null);
    setMsg(`${fmtNum(payload.length, lang)} ${t("dm_import_done")}`);
    await reload();
  }

  // ---------------- Saisie manuelle mensuelle ----------------
  const [month, setMonth] = useState(prevMonth(currentMonth()));
  const [kind, setKind] = useState<SellerKind>("traiteur");
  const [search, setSearch] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const monthStart = `${month}-01`;
  const monthEnd = lastDayOf(month);
  const existing = useMemo(() => {
    const m = new Map<string, SalesHistory>();
    for (const h of state.history) {
      if (h.seller_kind === kind && h.period_start === monthStart && h.period_end === monthEnd) m.set(h.product_id, h);
    }
    return m;
  }, [state.history, kind, monthStart, monthEnd]);

  const manualProducts = useMemo(() => {
    const s = search.trim().toLowerCase();
    return activeProducts.filter((p) => !s || p.name.toLowerCase().includes(s) || (p.name_fr ?? "").toLowerCase().includes(s));
  }, [activeProducts, search]);

  async function saveManual() {
    setSaving(true);
    const upserts: object[] = [];
    const deletes: string[] = [];
    for (const [pid, raw] of Object.entries(edits)) {
      const v = raw.trim() === "" ? null : parseFloat(raw.replace(",", "."));
      if (v === null || Number.isNaN(v)) {
        if (existing.has(pid)) deletes.push(existing.get(pid)!.id);
      } else {
        upserts.push({ product_id: pid, seller_kind: kind, period_start: monthStart, period_end: monthEnd, quantity: v });
      }
    }
    if (upserts.length)
      await supabase.from("sales_history").upsert(upserts, { onConflict: "product_id,seller_kind,period_start,period_end" });
    if (deletes.length) await supabase.from("sales_history").delete().in("id", deletes);
    setEdits({});
    setSaving(false);
    await reload();
  }

  // ---------------- Couverture ----------------
  const coverage = useMemo(() => {
    const m = new Map<string, { rows: number; retail: number; traiteur: number }>();
    for (const h of state.history) {
      const key = h.period_start.slice(0, 7);
      const c = m.get(key) ?? { rows: 0, retail: 0, traiteur: 0 };
      c.rows++;
      c[h.seller_kind] += Number(h.quantity);
      m.set(key, c);
    }
    return Array.from(m.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [state.history]);

  async function deleteMonth(m: string) {
    if (!confirm(t("dm_delete_month_confirm"))) return;
    const { start, end } = monthRange(m);
    await supabase.from("sales_history").delete().gte("period_start", start).lt("period_start", end);
    await reload();
  }

  const dirty = Object.keys(edits).length > 0;

  return (
    <div className="space-y-4">
      {/* Import Excel */}
      <div className="card p-4">
        <h2 className="mb-1 font-semibold">{t("dm_hist_import_title")}</h2>
        <p className="mb-3 text-sm text-muted">{t("dm_hist_import_hint")}</p>
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={onFile} />
          <button onClick={downloadTemplate} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold">
            ⬇️ {t("dm_download_template")}
          </button>
          <button onClick={() => fileRef.current?.click()} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg">
            ⬆️ {t("dm_import_file")}
          </button>
        </div>
        {msg && <p className="mt-3 rounded-lg bg-primary/10 px-4 py-2 text-sm text-primary">{msg}</p>}

        {parsed && !parsed.recognized && (
          <p className="mt-3 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">{t("dm_import_unrecognized")}</p>
        )}
        {parsed && parsed.recognized && preview && (
          <div className="mt-4 rounded-lg border border-border p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
              <div>
                <b>{fmtNum(parsed.rows.length, lang)}</b> {t("dm_import_rows")} · <b>{fmtNum(preview.matched, lang)}</b>{" "}
                {t("dm_import_matched")}
                {preview.from && (
                  <span className="text-muted">
                    {" "}· {t("dm_import_period")} <span dir="ltr">{preview.from} → {preview.to}</span>
                  </span>
                )}
              </div>
              <button onClick={() => setParsed(null)} className="text-muted hover:underline">{t("cancel")}</button>
            </div>

            {parsed.errors.length > 0 && (
              <details className="mb-2 text-sm text-danger">
                <summary>{fmtNum(parsed.errors.length, lang)} {t("dm_import_errors")}</summary>
                <ul className="mt-1 list-disc ps-5 text-xs">
                  {parsed.errors.slice(0, 20).map((e, i) => (
                    <li key={i}>{e.sheet} · L{e.line} · {e.reason}</li>
                  ))}
                </ul>
              </details>
            )}

            {preview.unmatched.length > 0 && (
              <div className="mb-3">
                <p className="mb-2 text-sm font-medium">{t("dm_import_unmatched")}</p>
                <div className="max-h-64 space-y-1.5 overflow-auto">
                  {preview.unmatched.map(([label, n]) => (
                    <div key={label} className="grid items-center gap-2 text-sm sm:grid-cols-2">
                      <span>{label} <span className="text-xs text-muted">({n})</span></span>
                      <select className="input" value={mapping[normLabel(label)] ?? ""}
                        onChange={(e) => setMapping({ ...mapping, [normLabel(label)]: e.target.value })}>
                        <option value="">{t("dm_ignore")}</option>
                        {activeProducts.map((p) => (
                          <option key={p.id} value={p.id}>{p.name_fr || p.name}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button onClick={confirmImport} disabled={importing || parsed.rows.length === 0}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg disabled:opacity-50">
              {importing ? t("importing") : t("dm_import_confirm")}
            </button>
          </div>
        )}
        <p className="mt-3 text-xs text-muted">{t("dm_live_note")}</p>
      </div>

      {/* Saisie manuelle */}
      <div className="card p-4">
        <h2 className="mb-1 font-semibold">{t("dm_manual_title")}</h2>
        <p className="mb-3 text-sm text-muted">{t("dm_manual_hint")}</p>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-muted">{t("dm_month")}</span>
            <input className="input" type="month" value={month}
              onChange={(e) => { if (e.target.value) { setMonth(e.target.value); setEdits({}); } }} />
          </label>
          <select className="input w-auto" value={kind} onChange={(e) => { setKind(e.target.value as SellerKind); setEdits({}); }}>
            <option value="retail">{t("dm_kind_retail")}</option>
            <option value="traiteur">{t("dm_kind_traiteur")}</option>
          </select>
          <input className="input w-48" placeholder={t("search")} value={search} onChange={(e) => setSearch(e.target.value)} />
          <button onClick={saveManual} disabled={!dirty || saving}
            className="ms-auto rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg disabled:opacity-50">
            {saving ? t("saving") : t("save")}
          </button>
        </div>
        <div className="max-h-[28rem] overflow-auto rounded border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface text-muted">
              <tr className="border-b border-border">
                <th className="px-3 py-1.5 text-start font-medium">{t("product")}</th>
                <th className="px-3 py-1.5 text-start font-medium">{t("category")}</th>
                <th className="px-3 py-1.5 text-end font-medium">{t("quantity")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {manualProducts.map((p) => {
                const cur = existing.get(p.id);
                return (
                  <tr key={`${p.id}-${month}-${kind}`}>
                    <td className="px-3 py-1">{p.name_fr || p.name}</td>
                    <td className="px-3 py-1 text-muted">{p.category ?? "—"}</td>
                    <td className="px-3 py-1 text-end">
                      <input type="number" min={0} defaultValue={cur ? Number(cur.quantity) : ""}
                        onChange={(e) => setEdits((x) => ({ ...x, [p.id]: e.target.value }))}
                        className={`w-24 rounded border px-1.5 py-1 text-end focus:border-primary focus:outline-none ${
                          edits[p.id] !== undefined ? "border-primary" : "border-border"
                        }`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Couverture */}
      <div className="card overflow-x-auto p-4">
        <h2 className="mb-2 font-semibold">{t("dm_coverage_title")}</h2>
        {coverage.length === 0 ? (
          <p className="text-sm text-muted">{t("no_data")}</p>
        ) : (
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="px-3 py-1.5 text-start font-medium">{t("dm_month")}</th>
                <th className="px-3 py-1.5 text-end font-medium">{t("dm_retail_short")}</th>
                <th className="px-3 py-1.5 text-end font-medium">{t("dm_traiteur_short")}</th>
                <th className="px-3 py-1.5 text-end font-medium">{t("dm_rows")}</th>
                <th className="px-3 py-1.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {coverage.map(([m, c]) => (
                <tr key={m}>
                  <td className="px-3 py-1.5 capitalize">{monthLabel(m, lang)}</td>
                  <td className="px-3 py-1.5 text-end tabular-nums">{fmtNum(Math.round(c.retail), lang)}</td>
                  <td className="px-3 py-1.5 text-end tabular-nums">{fmtNum(Math.round(c.traiteur), lang)}</td>
                  <td className="px-3 py-1.5 text-end text-muted">{fmtNum(c.rows, lang)}</td>
                  <td className="px-3 py-1.5 text-end">
                    <button onClick={() => deleteMonth(m)} className="text-danger hover:underline">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
