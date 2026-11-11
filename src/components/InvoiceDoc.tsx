"use client";

// Document facture de vente imprimable (HTML + window.print : gère l'arabe/RTL).
import { fmtMoney, fmtNum } from "@/lib/format";
import { useCompany } from "@/lib/settings";
import { invoiceTotals } from "@/lib/ventilation";
import type { SalesInvoice, SalesInvoiceItem } from "@/lib/types";

export default function InvoiceDoc({
  invoice,
  items,
  onBack,
  t,
  lang,
}: {
  invoice: SalesInvoice;
  items: SalesInvoiceItem[];
  onBack?: () => void;
  t: (k: string) => string;
  lang: "fr" | "ar";
}) {
  const company = useCompany();
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
      {onBack && (
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
      )}

      <div className="print-area invoice-page card p-5">
        <div className="mb-4 flex items-center justify-between gap-4 border-b-2 border-primary pb-3">
          <div className="text-lg font-bold tracking-wide text-primary">{company.name}</div>
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
            <div className="font-semibold">{invoice.client_name || "—"}</div>
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
                  <td className="px-2 py-1.5 text-end">{Number(l.unit_price).toLocaleString(lang === "ar" ? "ar-MA" : "fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 3 })}</td>
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
            {company.address} · {t("phone")} : {company.tel} · {company.email}
          </div>
          <div>
            RC : {company.rc} · Patente : {company.patente} · IF : {company.if} · ICE : {company.ice}
          </div>
        </div>
      </div>
    </div>
  );
}
