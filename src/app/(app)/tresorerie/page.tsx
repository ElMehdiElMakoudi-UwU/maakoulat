"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { currentMonth, fmtMoney, monthLabel, monthRange, ttc } from "@/lib/format";
import { SERIES, INK } from "@/lib/chartColors";

export default function TresoreriePage() {
  const { t, lang } = useI18n();
  const supabase = useMemo(() => createClient(), []);
  const [month, setMonth] = useState(currentMonth());
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(0);
  const [openingInput, setOpeningInput] = useState("");
  const [saved, setSaved] = useState(false);

  const [salesByDay, setSalesByDay] = useState<Record<number, number>>({});
  const [payByDay, setPayByDay] = useState<Record<number, number>>({});
  const [caTotal, setCaTotal] = useState(0);
  const [payTotal, setPayTotal] = useState(0);
  const [chargesTotal, setChargesTotal] = useState(0);

  useEffect(() => {
    setLoading(true);
    const { start, end } = monthRange(month);
    (async () => {
      const [salesRes, payRes, chargeRes, setRes] = await Promise.all([
        supabase.from("sales").select("sale_date,quantity,sale_price,products(vat_rate)").gte("sale_date", start).lt("sale_date", end),
        supabase.from("supplier_payments").select("pay_date,amount").gte("pay_date", start).lt("pay_date", end),
        supabase.from("charges").select("amount,month,active").or(`month.is.null,month.eq.${month}`),
        supabase.from("monthly_settings").select("*").eq("month", month).maybeSingle(),
      ]);

      const sByDay: Record<number, number> = {};
      let ca = 0;
      for (const s of (salesRes.data as { sale_date: string; quantity: number; sale_price: number; products: { vat_rate: number } | { vat_rate: number }[] | null }[]) ?? []) {
        const day = Number(s.sale_date.slice(8, 10));
        const vat = (Array.isArray(s.products) ? s.products[0] : s.products)?.vat_rate ?? 0;
        const v = s.quantity * ttc(s.sale_price, vat);
        sByDay[day] = (sByDay[day] ?? 0) + v;
        ca += v;
      }
      const pByDay: Record<number, number> = {};
      let pay = 0;
      for (const p of (payRes.data as { pay_date: string; amount: number }[]) ?? []) {
        const day = Number(p.pay_date.slice(8, 10));
        pByDay[day] = (pByDay[day] ?? 0) + Number(p.amount);
        pay += Number(p.amount);
      }
      const ch = ((chargeRes.data as { amount: number; active: boolean }[]) ?? [])
        .filter((c) => c.active).reduce((s, c) => s + Number(c.amount), 0);

      const settings = setRes.data as { opening_balance: number } | null;
      const op = settings ? Number(settings.opening_balance) : 0;

      setSalesByDay(sByDay);
      setPayByDay(pByDay);
      setCaTotal(ca);
      setPayTotal(pay);
      setChargesTotal(ch);
      setOpening(op);
      setOpeningInput(op ? String(op) : "");
      setLoading(false);
    })();
  }, [supabase, month]);

  const outflows = payTotal + chargesTotal;
  const net = caTotal - outflows;
  const closing = opening + net;

  // Courbe : solde cumulé jour par jour (charges imputées au 1er)
  const daily = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const days = new Date(y, m, 0).getDate();
    let bal = opening;
    const out: { day: string; balance: number }[] = [];
    for (let d = 1; d <= days; d++) {
      const inflow = salesByDay[d] ?? 0;
      const outflow = (payByDay[d] ?? 0) + (d === 1 ? chargesTotal : 0);
      bal += inflow - outflow;
      out.push({ day: String(d), balance: Math.round(bal) });
    }
    return out;
  }, [month, opening, salesByDay, payByDay, chargesTotal]);

  async function saveOpening() {
    const op = parseFloat(openingInput) || 0;
    await supabase.from("monthly_settings").upsert({ month, opening_balance: op }, { onConflict: "month" });
    setOpening(op);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("treasury_title")}</h1>
          <p className="text-sm text-muted">{t("treasury_hint")}</p>
        </div>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2 outline-none focus:border-primary" />
      </div>

      {loading ? (
        <p className="p-8 text-center text-muted">{t("loading")}</p>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label={t("inflows")} value={fmtMoney(caTotal, lang)} accent="success" />
            <Kpi label={t("outflows")} value={fmtMoney(outflows, lang)} accent="danger" />
            <Kpi label={t("balance")} value={fmtMoney(net, lang)} accent={net >= 0 ? "success" : "danger"} />
            <Kpi label={t("closing_balance")} value={fmtMoney(closing, lang)} accent={closing >= 0 ? "primary" : "danger"} />
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            {/* Courbe solde cumulé */}
            <div className="card p-4 lg:col-span-2" dir="ltr">
              <h2 className="font-bold">{t("cumulative_balance")}</h2>
              <p className="mb-2 text-xs text-muted">{monthLabel(month, lang)}</p>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={daily} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                  <defs>
                    <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={SERIES.ca} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={SERIES.ca} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={INK.grid} vertical={false} />
                  <XAxis dataKey="day" tick={{ fill: INK.secondary, fontSize: 12 }} tickLine={false} axisLine={{ stroke: INK.grid }} />
                  <YAxis tick={{ fill: INK.secondary, fontSize: 12 }} tickLine={false} axisLine={false} width={70}
                    tickFormatter={(v) => new Intl.NumberFormat("fr").format(v as number)} />
                  <Tooltip content={<BalTooltip lang={lang} label={t("cumulative_balance")} />} />
                  <Area isAnimationActive={false} type="monotone" dataKey="balance" stroke={SERIES.ca} strokeWidth={2} fill="url(#balGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Détail + solde d'ouverture */}
            <div className="space-y-5">
              <div className="card p-4">
                <h2 className="mb-3 font-bold">{t("balance")}</h2>
                <Line label={t("opening_balance")} value={fmtMoney(opening, lang)} muted />
                <Line label={t("sales_revenue")} value={`+ ${fmtMoney(caTotal, lang)}`} positive />
                <Line label={t("supplier_pay")} value={`− ${fmtMoney(payTotal, lang)}`} />
                <Line label={t("total_charges")} value={`− ${fmtMoney(chargesTotal, lang)}`} />
                <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
                  <span className="font-bold">{t("closing_balance")}</span>
                  <span className={`text-lg font-bold ${closing >= 0 ? "text-success" : "text-danger"}`}>{fmtMoney(closing, lang)}</span>
                </div>
              </div>

              <div className="card p-4">
                <label className="mb-1 block text-sm font-medium">{t("opening_balance")}</label>
                <div className="flex gap-2">
                  <input type="number" value={openingInput} onChange={(e) => setOpeningInput(e.target.value)}
                    placeholder="0" className="input" />
                  <button onClick={saveOpening} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg">
                    {saved ? t("saved") : t("save_settings")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: "primary" | "success" | "danger" }) {
  const color = accent === "primary" ? "text-primary" : accent === "success" ? "text-success" : accent === "danger" ? "text-danger" : "text-foreground";
  return (
    <div className="card p-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={`mt-1 text-xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

function Line({ label, value, positive, muted }: { label: string; value: string; positive?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className={muted ? "text-muted" : ""}>{label}</span>
      <span className={`font-semibold ${positive ? "text-success" : ""}`}>{value}</span>
    </div>
  );
}

function BalTooltip({ active, payload, label, lang }: {
  active?: boolean; payload?: { value: number }[]; label?: string; lang: "fr" | "ar";
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface p-2.5 text-xs shadow-sm">
      <div className="mb-0.5 text-muted">{(lang === "ar" ? "اليوم " : "Jour ") + label}</div>
      <div style={{ color: INK.primary }} className="font-semibold">{fmtMoney(payload[0].value, lang)}</div>
    </div>
  );
}
