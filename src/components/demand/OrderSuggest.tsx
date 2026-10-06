"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { fmtNum } from "@/lib/format";
import { addDays } from "@/lib/supplierDues";
import { DemandModel } from "@/lib/demandForecast";
import { loadDemandState, toInputs } from "@/lib/demandData";
import type { Product } from "@/lib/types";
import { CoefBadge } from "./ForecastTab";

/**
 * Panneau de suggestion de quantités pour un bon de commande :
 * suggéré = prévision sur la période × (1 + marge) − stock, arrondi au-dessus.
 */
export default function OrderSuggest({
  products,
  orderDate,
  onApply,
  onClose,
}: {
  products: Product[];
  orderDate: string;
  onApply: (lines: { product: Product; quantity: number }[]) => void;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const supabase = useMemo(() => createClient(), []);
  const [model, setModel] = useState<DemandModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState("7");
  const [safety, setSafety] = useState("10");
  const [stock, setStock] = useState<Record<string, string>>({});

  useEffect(() => {
    loadDemandState(supabase)
      .then((s) => setModel(new DemandModel(toInputs(s))))
      .catch(() => setError(t("dm_missing_tables")));
  }, [supabase, t]);

  const nDays = Math.max(1, Math.min(120, parseInt(days) || 1));
  const margin = Math.max(0, parseFloat(safety) || 0) / 100;
  const to = addDays(orderDate, nDays - 1);

  const rows = useMemo(() => {
    if (!model) return [];
    return products
      .map((p) => {
        const f = model.forecast(p.id, orderDate, to);
        const st = parseFloat(stock[p.id] ?? "") || 0;
        return { p, ...f, suggested: Math.max(0, Math.ceil(f.qty * (1 + margin) - st)) };
      })
      .sort((a, b) => b.qty - a.qty);
  }, [model, products, orderDate, to, stock, margin]);

  return (
    <div className="no-print card mb-4 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">📈 {t("dm_suggest_title")}</h2>
        <button onClick={onClose} className="text-sm text-muted hover:underline">{t("cancel")}</button>
      </div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-muted">{t("dm_cover_days")}</span>
          <input className="input w-28" type="number" min={1} max={120} value={days} onChange={(e) => setDays(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">{t("dm_safety")}</span>
          <input className="input w-28" type="number" min={0} value={safety} onChange={(e) => setSafety(e.target.value)} />
        </label>
        <span className="pb-2 text-sm text-muted" dir="ltr">{orderDate} → {to}</span>
      </div>
      <p className="mb-3 text-xs text-muted">{t("dm_suggest_hint")}</p>

      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : !model ? (
        <p className="p-4 text-center text-muted">{t("loading")}</p>
      ) : (
        <>
          <div className="max-h-80 overflow-auto rounded border border-border">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="sticky top-0 bg-surface text-muted">
                <tr className="border-b border-border">
                  <th className="px-3 py-1.5 text-start font-medium">{t("product")}</th>
                  <th className="px-3 py-1.5 text-center font-medium">{t("dm_coef")}</th>
                  <th className="px-3 py-1.5 text-end font-medium">{t("dm_forecast_qty")}</th>
                  <th className="px-3 py-1.5 text-end font-medium">{t("dm_stock")}</th>
                  <th className="px-3 py-1.5 text-end font-medium">{t("dm_suggested")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.p.id}>
                    <td className="px-3 py-1.5">{r.p.name_fr || r.p.name}</td>
                    <td className="px-3 py-1.5 text-center"><CoefBadge value={r.avgCoef} /></td>
                    <td className="px-3 py-1.5 text-end tabular-nums">{fmtNum(Math.round(r.qty), lang)}</td>
                    <td className="px-3 py-1.5 text-end">
                      <input type="number" min={0} value={stock[r.p.id] ?? ""} placeholder="0"
                        onChange={(e) => setStock({ ...stock, [r.p.id]: e.target.value })}
                        className="w-20 rounded border border-border px-1.5 py-1 text-end focus:border-primary focus:outline-none" />
                    </td>
                    <td className="px-3 py-1.5 text-end font-bold tabular-nums">{fmtNum(r.suggested, lang)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={5} className="p-4 text-center text-muted">{t("no_data")}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <button
            onClick={() => onApply(rows.filter((r) => r.suggested > 0).map((r) => ({ product: r.p, quantity: r.suggested })))}
            disabled={!rows.some((r) => r.suggested > 0)}
            className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg disabled:opacity-50"
          >
            {t("dm_apply")}
          </button>
        </>
      )}
    </div>
  );
}
