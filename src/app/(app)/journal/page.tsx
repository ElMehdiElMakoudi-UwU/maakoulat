"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { currentMonth, fmtMoney, fmtNum, monthLabel, monthRange } from "@/lib/format";
import type { Seller } from "@/lib/types";

interface Row {
  sale_date: string;
  seller_id: string;
  quantity: number;
  purchase_price: number;
  sale_price: number;
}

export default function JournalPage() {
  const { t, lang } = useI18n();
  const supabase = useMemo(() => createClient(), []);
  const [month, setMonth] = useState(currentMonth());
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const { start, end } = monthRange(month);
    (async () => {
      const [sellersRes, salesRes] = await Promise.all([
        supabase.from("sellers").select("*").order("sort_order"),
        supabase
          .from("sales")
          .select("sale_date,seller_id,quantity,purchase_price,sale_price")
          .gte("sale_date", start)
          .lt("sale_date", end),
      ]);
      setSellers((sellersRes.data as Seller[]) ?? []);
      setRows((salesRes.data as Row[]) ?? []);
      setLoading(false);
    })();
  }, [supabase, month]);

  // Regroupement par (date, vendeur)
  const days = useMemo(() => {
    const map = new Map<string, { date: string; seller_id: string; ca: number; profit: number; items: number; lines: number }>();
    for (const r of rows) {
      const key = `${r.sale_date}__${r.seller_id}`;
      const cur = map.get(key) ?? { date: r.sale_date, seller_id: r.seller_id, ca: 0, profit: 0, items: 0, lines: 0 };
      cur.ca += r.quantity * r.sale_price;
      cur.profit += r.quantity * (r.sale_price - r.purchase_price);
      cur.items += r.quantity;
      cur.lines += 1;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.date === b.date ? a.seller_id.localeCompare(b.seller_id) : b.date.localeCompare(a.date)
    );
  }, [rows]);

  const sellerName = (id: string) => sellers.find((s) => s.id === id)?.name ?? "—";
  const fmtDate = (d: string) =>
    new Intl.DateTimeFormat(lang === "ar" ? "ar-MA" : "fr-FR", { weekday: "short", day: "numeric", month: "short" }).format(
      new Date(d + "T00:00:00")
    );

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("history_title")}</h1>
          <p className="text-sm text-muted">{t("history_hint")}</p>
        </div>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2 outline-none focus:border-primary" />
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <p className="p-8 text-center text-muted">{t("loading")}</p>
        ) : days.length === 0 ? (
          <p className="p-8 text-center text-muted">{t("no_history")}</p>
        ) : (
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="px-4 py-2 text-start font-medium">{t("date")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("seller")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("nb_products")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("ca")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("profit")}</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {days.map((d) => (
                <tr key={`${d.date}__${d.seller_id}`} className="hover:bg-background">
                  <td className="px-4 py-2.5 font-medium capitalize">{fmtDate(d.date)}</td>
                  <td className="px-4 py-2.5">{sellerName(d.seller_id)}</td>
                  <td className="px-4 py-2.5 text-end text-muted">{d.lines}</td>
                  <td className="px-4 py-2.5 text-end font-semibold">{fmtMoney(d.ca, lang)}</td>
                  <td className="px-4 py-2.5 text-end text-success">{fmtMoney(d.profit, lang)}</td>
                  <td className="px-4 py-2.5 text-end">
                    <Link href={`/ventes?seller=${d.seller_id}&date=${d.date}`}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface">
                      {t("edit_day")} ✏️
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="mt-2 text-sm capitalize text-muted">{monthLabel(month, lang)}</p>
    </div>
  );
}
