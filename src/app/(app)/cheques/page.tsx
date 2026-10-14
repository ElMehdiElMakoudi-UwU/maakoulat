"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { currentMonth, fmtMoney, monthLabel, today, ttc } from "@/lib/format";
import { fetchAll } from "@/lib/demandData";
import { addDays, daysBetween } from "@/lib/supplierDues";
import { weekday } from "@/lib/treasuryForecast";
import {
  DEFAULT_PLANNER_SETTINGS, PLANNER_SETTINGS_KEY, analyseCheques, lastChequeDate, rescheduleDate, simulate, suggestDate,
  workingDaysInMonth, type ChequePlannerSettings, type PlanInput, type PlannedCheque,
} from "@/lib/chequePlanner";
import type { Seller, Supplier, SupplierCheque, SupplierPayment } from "@/lib/types";

const HISTORY_MONTHS = 3; // mois complets utilisés pour le CA/J
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // lundi → dimanche
const WD_LABEL: Record<"fr" | "ar", string[]> = {
  fr: ["Di", "Lu", "Ma", "Me", "Je", "Ve", "Sa"],
  ar: ["أحد", "إثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"],
};

type SaleRow = {
  sale_date: string;
  seller_id: string;
  quantity: number;
  sale_price: number;
  products: { vat_rate: number } | { vat_rate: number }[] | null;
};

const fmtDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export default function ChequesPage() {
  const { t, lang } = useI18n();
  const supabase = useMemo(() => createClient(), []);
  const todayStr = today();

  const [loading, setLoading] = useState(true);
  const [missingTable, setMissingTable] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [salesByMonth, setSalesByMonth] = useState<Record<string, Record<string, number>>>({});
  const [cheques, setCheques] = useState<SupplierCheque[]>([]);
  const [settings, setSettings] = useState<ChequePlannerSettings>(DEFAULT_PLANNER_SETTINGS);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [startCash, setStartCash] = useState("0");

  // Formulaire « nouveau chèque »
  const [form, setForm] = useState({ supplier_id: "", amount: "", number: "", notBefore: "", date: "", note: "" });
  const [showClosed, setShowClosed] = useState(false);
  const [calMonth, setCalMonth] = useState(currentMonth());

  const loadCheques = useCallback(async () => {
    const { data, error } = await supabase.from("supplier_cheques").select("*").order("due_date");
    if (error) {
      setMissingTable(true);
      return;
    }
    setCheques((data as SupplierCheque[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    const from = `${shiftMonth(currentMonth(), -(HISTORY_MONTHS + 3))}-01`;
    (async () => {
      const [supRes, sellerRes, setRes, sales] = await Promise.all([
        supabase.from("suppliers").select("*").order("sort_order"),
        supabase.from("sellers").select("*").order("sort_order"),
        supabase.from("app_settings").select("value").eq("key", PLANNER_SETTINGS_KEY).maybeSingle(),
        fetchAll<SaleRow>((a, b) =>
          supabase.from("sales").select("sale_date,seller_id,quantity,sale_price,products(vat_rate)")
            .gte("sale_date", from).lte("sale_date", todayStr).order("id").range(a, b)),
        loadCheques(),
      ]);
      const sellerRows = ((sellerRes.data as Seller[]) ?? []).filter((s) => s.active);
      setSuppliers(((supRes.data as Supplier[]) ?? []).filter((s) => s.active));
      setSellers(sellerRows);

      // CA TTC par vendeur et par mois
      const bm: Record<string, Record<string, number>> = {};
      for (const s of sales) {
        const p = Array.isArray(s.products) ? s.products[0] : s.products;
        const month = s.sale_date.slice(0, 7);
        bm[s.seller_id] ??= {};
        bm[s.seller_id][month] = (bm[s.seller_id][month] ?? 0) + s.quantity * ttc(s.sale_price, p?.vat_rate ?? 0);
      }
      setSalesByMonth(bm);

      // Réglages enregistrés ; par défaut seuls les vendeurs retail financent les chèques
      let saved: Partial<ChequePlannerSettings> = {};
      try {
        const raw = (setRes.data as { value: string | null } | null)?.value;
        if (raw) saved = JSON.parse(raw);
      } catch {}
      const included: Record<string, boolean> = {};
      for (const s of sellerRows) included[s.id] = saved.included?.[s.id] ?? s.kind === "retail";
      setSettings({ ...DEFAULT_PLANNER_SETTINGS, ...saved, included });
      setLoading(false);
    })();
  }, [supabase, todayStr, loadCheques]);

  // CA/J historique : CA des derniers mois complets ÷ jours ouvrés de ces mois
  const historyRates = useMemo(() => {
    const cur = currentMonth();
    const out: Record<string, { rate: number; months: string[] }> = {};
    for (const s of sellers) {
      const byMonth = salesByMonth[s.id] ?? {};
      const months = Object.keys(byMonth).filter((m) => m < cur && byMonth[m] > 0).sort().slice(-HISTORY_MONTHS);
      const total = months.reduce((a, m) => a + byMonth[m], 0);
      const days = months.reduce((a, m) => a + workingDaysInMonth(m, settings.restDays), 0);
      out[s.id] = { rate: days ? total / days : 0, months };
    }
    return out;
  }, [sellers, salesByMonth, settings.restDays]);

  const rateOf = (id: string) => settings.rates[id] ?? historyRates[id]?.rate ?? 0;
  const grossDaily = sellers.filter((s) => settings.included[s.id]).reduce((a, s) => a + rateOf(s.id), 0);
  const dailyRate = (grossDaily * Math.max(0, settings.availablePct)) / 100;
  const buffer = Math.max(0, settings.buffer || 0);

  const pending = useMemo(() => cheques.filter((c) => c.status === "pending"), [cheques]);
  const planned = useMemo<PlannedCheque[]>(
    () => pending.map((c) => ({ id: c.id, date: c.due_date, amount: Number(c.amount) })),
    [pending]
  );
  const input: PlanInput = useMemo(
    () => ({ today: todayStr, startCash: parseFloat(startCash) || 0, dailyRate, restDays: settings.restDays, cheques: planned }),
    [todayStr, startCash, dailyRate, settings.restDays, planned]
  );

  const risks = useMemo(() => analyseCheques(input, buffer), [input, buffer]);
  const atRisk = pending.filter((c) => (risks.get(c.id)?.short ?? 0) > 0.005);

  // Suggestion pour le chèque en préparation
  const amount = parseFloat(form.amount) || 0;
  const suggestion = useMemo(
    () => (amount > 0 ? suggestDate(input, amount, buffer, form.notBefore || undefined) : null),
    [input, amount, buffer, form.notBefore]
  );
  const chosenDate = form.date || suggestion?.date || "";
  // Si l'utilisateur force une date : solde au point le plus serré, à partir de cette date, avec ce chèque ajouté
  const chosenCheck = useMemo(() => {
    if (!amount || !chosenDate) return null;
    const withNew = { ...input, cheques: [...planned, { id: "__new", date: chosenDate, amount }] };
    const days = simulate(withNew, lastChequeDate(withNew.cheques, todayStr));
    const from = chosenDate < todayStr ? todayStr : chosenDate;
    const worst = Math.min(...days.filter((d) => d.date >= from).map((d) => d.checkpoint));
    return { worst, ok: worst >= buffer - 1e-6 };
  }, [input, planned, amount, chosenDate, buffer, todayStr]);

  // Calendrier : solde de fin de journée sur le mois affiché
  const calDays = useMemo(() => {
    const first = `${calMonth}-01`;
    const last = addDays(`${shiftMonth(calMonth, 1)}-01`, -1);
    const sim = last >= todayStr ? simulate(input, last) : [];
    const byDate = new Map(sim.map((d) => [d.date, d]));
    const cells: ({ date: string; balance: number | null; rest: boolean } | null)[] = [];
    const lead = WEEK_ORDER.indexOf(weekday(first));
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = first; d <= last; d = addDays(d, 1)) {
      cells.push({ date: d, balance: byDate.get(d)?.balance ?? null, rest: settings.restDays.includes(weekday(d)) });
    }
    return cells;
  }, [calMonth, input, todayStr, settings.restDays]);

  const supplierName = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);
  const chequesByDate = useMemo(() => {
    const m = new Map<string, SupplierCheque[]>();
    for (const c of pending) {
      const d = c.due_date < todayStr ? todayStr : c.due_date;
      m.set(d, [...(m.get(d) ?? []), c]);
    }
    return m;
  }, [pending, todayStr]);

  // ---------- Actions ----------
  async function saveSettings(next = settings) {
    await supabase.from("app_settings").upsert(
      { key: PLANNER_SETTINGS_KEY, value: JSON.stringify(next) },
      { onConflict: "key" }
    );
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 2000);
  }

  function setRate(id: string, v: string) {
    setSettings((s) => {
      const rates = { ...s.rates };
      if (v.trim() === "") delete rates[id];
      else rates[id] = parseFloat(v) || 0;
      return { ...s, rates };
    });
  }

  function toggleRestDay(d: number) {
    setSettings((s) => ({
      ...s,
      restDays: s.restDays.includes(d) ? s.restDays.filter((x) => x !== d) : [...s.restDays, d],
    }));
  }

  async function addCheque() {
    if (!form.supplier_id || !amount || !chosenDate) return;
    await supabase.from("supplier_cheques").insert({
      supplier_id: form.supplier_id,
      cheque_number: form.number.trim() || null,
      amount,
      issue_date: todayStr,
      due_date: chosenDate,
      note: form.note.trim() || null,
    });
    setForm({ supplier_id: form.supplier_id, amount: "", number: "", notBefore: "", date: "", note: "" });
    await loadCheques();
  }

  async function updateDate(c: SupplierCheque, due: string) {
    if (!due) return;
    await supabase.from("supplier_cheques").update({ due_date: due }).eq("id", c.id);
    await loadCheques();
  }

  /**
   * Chèque débité : rattache un paiement existant (même fournisseur, même montant,
   * ±10 jours — ex. créé par le rapprochement bancaire) ou en crée un.
   */
  async function markCashed(c: SupplierCheque) {
    const payDate = c.due_date > todayStr ? todayStr : c.due_date;
    const linked = new Set(cheques.map((x) => x.payment_id).filter(Boolean));
    const { data } = await supabase.from("supplier_payments").select("*")
      .eq("supplier_id", c.supplier_id).eq("amount", c.amount)
      .gte("pay_date", addDays(c.due_date, -10)).lte("pay_date", addDays(c.due_date, 10));
    let paymentId = ((data as SupplierPayment[]) ?? []).find((p) => !linked.has(p.id))?.id ?? null;
    if (!paymentId) {
      const { data: pay } = await supabase.from("supplier_payments").insert({
        supplier_id: c.supplier_id,
        pay_date: payDate,
        amount: c.amount,
        note: c.cheque_number ? `Chèque n° ${c.cheque_number}` : "Chèque",
      }).select().single();
      paymentId = (pay as { id: string } | null)?.id ?? null;
    }
    await supabase.from("supplier_cheques").update({ status: "cashed", payment_id: paymentId }).eq("id", c.id);
    await loadCheques();
  }

  async function cancelCheque(c: SupplierCheque) {
    if (!confirm(t("chq_confirm_cancel"))) return;
    await supabase.from("supplier_cheques").update({ status: "cancelled" }).eq("id", c.id);
    await loadCheques();
  }

  async function deleteCheque(c: SupplierCheque) {
    if (!confirm(t("confirm_delete"))) return;
    await supabase.from("supplier_cheques").delete().eq("id", c.id);
    await loadCheques();
  }

  if (loading) return <p className="p-8 text-center text-muted">{t("loading")}</p>;

  if (missingTable) {
    return (
      <div>
        <h1 className="mb-4 text-2xl font-bold">{t("chq_title")}</h1>
        <div className="rounded-xl border border-accent/40 bg-accent/5 px-4 py-3 text-sm">{t("chq_missing_table")}</div>
      </div>
    );
  }

  const listed = (showClosed ? cheques : pending).slice().sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
  const pendingTotal = pending.reduce((a, c) => a + Number(c.amount), 0);
  const lastDate = pending.reduce((m, c) => (c.due_date > m ? c.due_date : m), "");

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold">{t("chq_title")}</h1>
        <p className="text-sm text-muted">{t("chq_subtitle")}</p>
      </div>

      {/* KPI */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("chq_pending_total")} value={fmtMoney(pendingTotal, lang)} sub={`${pending.length} ${t("chq_cheques")}`} />
        <Kpi label={t("chq_daily_in")} value={fmtMoney(dailyRate, lang)} sub={t("chq_per_working_day")} accent="success" />
        <Kpi
          label={t("chq_last_cheque")}
          value={lastDate ? fmtDate(lastDate) : "—"}
          sub={lastDate ? `${t("chq_in")} ${Math.max(0, daysBetween(todayStr, lastDate))} ${t("fc_days")}` : ""}
        />
        <Kpi
          label={t("chq_at_risk")}
          value={String(atRisk.length)}
          sub={atRisk.length ? t("chq_see_list") : t("chq_all_covered")}
          accent={atRisk.length ? "danger" : "success"}
        />
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        {/* Planifier un chèque */}
        <div className="card p-4">
          <h2 className="mb-3 font-bold">{t("chq_plan_title")}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium">{t("supplier")}</label>
              <select className="input" value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
                <option value="">—</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">{t("amount")}</label>
              <input type="number" min={0} className="input" value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value, date: "" })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">{t("chq_not_before")}</label>
              <input type="date" className="input" value={form.notBefore}
                onChange={(e) => setForm({ ...form, notBefore: e.target.value, date: "" })} />
            </div>
          </div>

          {amount > 0 && (
            suggestion ? (
              <div className="mt-4 rounded-xl border border-primary/40 bg-primary/5 p-4">
                <div className="text-xs font-medium text-muted">{t("chq_suggested")}</div>
                <div className="text-2xl font-bold text-primary"><bdi dir="ltr">{fmtDate(suggestion.date)}</bdi></div>
                <ul className="mt-2 space-y-1 text-sm">
                  {suggestion.squeezed && <li className="text-success">✓ {t("chq_squeezed")}</li>}
                  {suggestion.manual && (
                    <li className="text-muted">
                      {t("chq_manual_method")}: <bdi dir="ltr">{fmtDate(suggestion.manual)}</bdi>
                      {suggestion.manual > suggestion.date && (
                        <> · <span className="text-success">{daysBetween(suggestion.date, suggestion.manual)} {t("fc_days")} {t("chq_earlier")}</span></>
                      )}
                    </li>
                  )}
                  <li className="text-muted">
                    {t("chq_margin")}: <span className="font-medium text-foreground">{fmtMoney(suggestion.margin, lang)}</span>
                    {" "}(<bdi dir="ltr">{fmtDate(suggestion.tightest)}</bdi>)
                  </li>
                </ul>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger">
                {t("chq_no_date")}
              </div>
            )
          )}

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">{t("chq_date_on_cheque")}</label>
              <input type="date" className="input" value={chosenDate}
                onChange={(e) => setForm({ ...form, date: e.target.value })} />
              {chosenCheck && !chosenCheck.ok && (
                <p className="mt-1 text-xs text-danger">
                  ⚠ {t("chq_short_warning")} {fmtMoney(buffer - chosenCheck.worst, lang)}
                </p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">{t("chq_number")}</label>
              <input className="input" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium">{t("note")}</label>
              <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </div>
          </div>
          <button
            onClick={addCheque}
            disabled={!form.supplier_id || !amount || !chosenDate}
            className="mt-4 w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg disabled:opacity-50"
          >
            {t("chq_add")}
          </button>
        </div>

        {/* Encaissements journaliers */}
        <div className="card p-4">
          <h2 className="font-bold">{t("chq_collections_title")}</h2>
          <p className="mb-3 text-xs text-muted">{t("chq_collections_hint")}</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="py-2 text-start font-medium">{t("chq_seller")}</th>
                <th className="py-2 text-end font-medium">{t("chq_history_rate")}</th>
                <th className="py-2 text-end font-medium">{t("chq_rate_used")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sellers.map((s) => {
                const h = historyRates[s.id];
                return (
                  <tr key={s.id} className={settings.included[s.id] ? "" : "opacity-50"}>
                    <td className="py-2">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={!!settings.included[s.id]}
                          onChange={(e) => setSettings({ ...settings, included: { ...settings.included, [s.id]: e.target.checked } })} />
                        {s.name}
                      </label>
                    </td>
                    <td className="py-2 text-end text-muted">
                      {fmtMoney(h?.rate ?? 0, lang)}
                      {h?.months.length ? <div className="text-[11px]">{h.months.map((m) => m.slice(5)).join(", ")}</div> : null}
                    </td>
                    <td className="py-2 ps-2">
                      <input type="number" min={0} className="input text-end"
                        placeholder={String(Math.round(h?.rate ?? 0))}
                        value={settings.rates[s.id] ?? ""}
                        onChange={(e) => setRate(s.id, e.target.value)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="mt-4">
            <div className="mb-1 text-sm font-medium">{t("chq_rest_days")}</div>
            <div className="flex flex-wrap gap-1">
              {WEEK_ORDER.map((d) => (
                <button key={d} onClick={() => toggleRestDay(d)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                    settings.restDays.includes(d) ? "bg-danger/15 text-danger" : "border border-border"
                  }`}>
                  {WD_LABEL[lang][d]}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted">
              {workingDaysInMonth(currentMonth(), settings.restDays)} {t("chq_working_days_month")}
            </p>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium">{t("chq_available_pct")}</label>
              <input type="number" min={0} max={100} step={5} className="input" value={settings.availablePct}
                onChange={(e) => setSettings({ ...settings, availablePct: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">{t("chq_buffer")}</label>
              <input type="number" min={0} step={500} className="input" value={settings.buffer}
                onChange={(e) => setSettings({ ...settings, buffer: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">{t("chq_start_cash")}</label>
              <input type="number" className="input" value={startCash} onChange={(e) => setStartCash(e.target.value)} />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
            <span className="text-sm">
              {t("chq_daily_in")}: <span className="font-bold text-success">{fmtMoney(dailyRate, lang)}</span>
            </span>
            <button onClick={() => saveSettings()} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg">
              {settingsSaved ? t("saved") : t("save_settings")}
            </button>
          </div>
        </div>
      </div>

      {/* Alerte calendrier */}
      {atRisk.length > 0 ? (
        <div className="mb-5 rounded-xl border border-danger/40 bg-danger/5 px-4 py-3 text-sm">
          <span className="font-semibold text-danger">⚠ {atRisk.length} {t("chq_risk_banner")}</span>
          <span className="text-muted"> · {t("chq_first_risk")} <bdi dir="ltr">{fmtDate(atRisk[0].due_date < todayStr ? todayStr : atRisk[0].due_date)}</bdi></span>
        </div>
      ) : pending.length > 0 ? (
        <div className="mb-5 rounded-xl border border-success/40 bg-success/5 px-4 py-3 text-sm font-semibold text-success">
          ✓ {t("chq_all_covered")}
        </div>
      ) : null}

      {/* Calendrier */}
      <div className="card mb-5 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-bold">{t("chq_calendar")}</h2>
          <div className="flex items-center gap-1">
            <button onClick={() => setCalMonth(shiftMonth(calMonth, -1))} className="rounded-lg border border-border px-2.5 py-1 text-sm">‹</button>
            <span className="min-w-36 text-center text-sm font-medium capitalize">{monthLabel(calMonth, lang)}</span>
            <button onClick={() => setCalMonth(shiftMonth(calMonth, 1))} className="rounded-lg border border-border px-2.5 py-1 text-sm">›</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <div className="grid min-w-[640px] grid-cols-7 gap-1 text-xs">
            {WEEK_ORDER.map((d) => (
              <div key={d} className="px-1 py-1 text-center font-medium text-muted">{WD_LABEL[lang][d]}</div>
            ))}
            {calDays.map((cell, i) => {
              if (!cell) return <div key={`e${i}`} />;
              const list = chequesByDate.get(cell.date) ?? [];
              const isSuggested = suggestion?.date === cell.date && amount > 0;
              const risky = list.some((c) => (risks.get(c.id)?.short ?? 0) > 0.005);
              return (
                <div
                  key={cell.date}
                  className={`min-h-20 rounded-lg border p-1.5 ${
                    isSuggested ? "border-2 border-dashed border-primary bg-primary/5"
                    : risky ? "border-danger/50 bg-danger/5"
                    : cell.rest ? "border-border bg-background/60" : "border-border"
                  } ${cell.date === todayStr ? "ring-1 ring-primary" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`font-semibold ${cell.date < todayStr ? "text-muted" : ""}`}>{Number(cell.date.slice(8))}</span>
                    {cell.balance !== null && (
                      <span className={`text-[10px] ${cell.balance < buffer ? "text-danger" : "text-muted"}`}>
                        {new Intl.NumberFormat("fr").format(Math.round(cell.balance))}
                      </span>
                    )}
                  </div>
                  {list.map((c) => (
                    <div key={c.id} className="mt-1 truncate rounded bg-primary/10 px-1 py-0.5" title={supplierName.get(c.supplier_id) ?? ""}>
                      <span className="font-medium">{new Intl.NumberFormat("fr").format(Number(c.amount))}</span>{" "}
                      <span className="text-muted">{supplierName.get(c.supplier_id) ?? "—"}</span>
                    </div>
                  ))}
                  {isSuggested && (
                    <div className="mt-1 truncate rounded border border-dashed border-primary px-1 py-0.5 text-primary">
                      + {new Intl.NumberFormat("fr").format(amount)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <p className="mt-2 text-xs text-muted">{t("chq_calendar_hint")}</p>
      </div>

      {/* Liste des chèques */}
      <div className="card overflow-x-auto">
        <div className="flex items-center justify-between px-4 pt-4">
          <h2 className="font-bold">{t("chq_list")}</h2>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
            {t("chq_show_closed")}
          </label>
        </div>
        {listed.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted">{t("chq_none")}</p>
        ) : (
          <table className="mt-2 w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="px-4 py-2 text-start font-medium">{t("chq_date_on_cheque")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("supplier")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("chq_number")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("amount")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("chq_balance_after")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("status")}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {listed.map((c) => {
                const r = risks.get(c.id);
                const risky = c.status === "pending" && (r?.short ?? 0) > 0.005;
                const moveTo = risky ? rescheduleDate(input, { id: c.id, date: c.due_date, amount: Number(c.amount) }, buffer) : null;
                return (
                  <tr key={c.id} className={c.status !== "pending" ? "opacity-60" : ""}>
                    <td className="px-4 py-2">
                      {c.status === "pending" ? (
                        <input type="date" className="input w-40" value={c.due_date} onChange={(e) => updateDate(c, e.target.value)} />
                      ) : (
                        <bdi dir="ltr">{fmtDate(c.due_date)}</bdi>
                      )}
                    </td>
                    <td className="px-4 py-2 font-medium">{supplierName.get(c.supplier_id) ?? "—"}</td>
                    <td className="px-4 py-2 text-muted">{c.cheque_number ?? "—"}</td>
                    <td className="px-4 py-2 text-end font-semibold">{fmtMoney(Number(c.amount), lang)}</td>
                    <td className={`px-4 py-2 text-end ${risky ? "font-semibold text-danger" : ""}`}>
                      {c.status === "pending" && r ? fmtMoney(r.checkpoint, lang) : "—"}
                    </td>
                    <td className="px-4 py-2">
                      {c.status === "cashed" ? (
                        <span className="text-success">{t("chq_status_cashed")}</span>
                      ) : c.status === "cancelled" ? (
                        <span className="text-muted">{t("chq_status_cancelled")}</span>
                      ) : risky ? (
                        <div>
                          <span className="font-medium text-danger">{t("chq_status_risk")} ({fmtMoney(r!.short, lang)})</span>
                          {moveTo && moveTo !== c.due_date && (
                            <button onClick={() => updateDate(c, moveTo)} className="block text-xs text-primary hover:underline">
                              {t("chq_move_to")} <bdi dir="ltr">{fmtDate(moveTo)}</bdi>
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-success">{t("chq_status_ok")}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-end">
                      {c.status === "pending" && (
                        <>
                          <button onClick={() => markCashed(c)} className="me-3 text-xs font-medium text-success hover:underline">
                            {t("chq_mark_cashed")}
                          </button>
                          <button onClick={() => cancelCheque(c)} className="me-3 text-xs text-muted hover:underline">
                            {t("cancel")}
                          </button>
                        </>
                      )}
                      <button onClick={() => deleteCheque(c)} className="text-xs text-danger hover:underline">{t("delete")}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "success" | "danger" }) {
  const color = accent === "success" ? "text-success" : accent === "danger" ? "text-danger" : "text-foreground";
  return (
    <div className="card p-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={`mt-1 text-xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}
