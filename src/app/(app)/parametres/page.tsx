"use client";

import { useMemo, useState } from "react";
import JSZip from "jszip";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { rowsToCsv, downloadFile } from "@/lib/csv";

const BACKUP_TABLES = [
  "sellers",
  "products",
  "sales",
  "suppliers",
  "supplier_payments",
  "supplier_invoices",
  "charges",
  "clients",
  "purchase_orders",
  "purchase_order_items",
  "sales_invoices",
  "sales_invoice_items",
  "monthly_ventilation",
  "ventilation_targets",
  "monthly_settings",
  "bank_statements",
  "bank_transactions",
  "app_settings",
] as const;

export default function ParametresPage() {
  const { t, lang } = useI18n();
  const supabase = useMemo(() => createClient(), []);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [doneAt, setDoneAt] = useState<number | null>(null);

  async function exportBackup() {
    setExporting(true);
    setError("");
    setDoneAt(null);
    try {
      const zip = new JSZip();
      for (const table of BACKUP_TABLES) {
        setProgress(table);
        const { data, error: qErr } = await supabase.from(table).select("*");
        if (qErr) throw new Error(`${table}: ${qErr.message}`);
        zip.file(`${table}.csv`, rowsToCsv((data as Record<string, unknown>[]) ?? []));
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const date = new Date().toISOString().slice(0, 10);
      downloadFile(`maakoulat-sauvegarde-${date}.zip`, blob);
      setDoneAt(Date.now());
    } catch {
      setError(t("backup_error"));
    } finally {
      setExporting(false);
      setProgress("");
    }
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold">{t("settings_title")}</h1>
        <p className="text-sm text-muted">{t("settings_hint")}</p>
      </div>

      <div className="card max-w-xl p-5">
        <h2 className="font-bold">💾 {t("backup_title")}</h2>
        <p className="mt-1 text-sm text-muted">{t("backup_hint")}</p>

        <button
          onClick={exportBackup}
          disabled={exporting}
          className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg hover:opacity-90 disabled:opacity-60"
        >
          {exporting
            ? `${t("backup_exporting")} (${progress})`
            : `⬇️ ${t("backup_export_btn")}`}
        </button>

        {doneAt && (
          <p className="mt-3 rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">
            {t("backup_done")}
          </p>
        )}
        {error && (
          <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
        )}
        <p className="mt-3 text-xs text-muted" dir={lang === "ar" ? "rtl" : "ltr"}>
          {t("backup_tables_hint")}
        </p>
      </div>
    </div>
  );
}
