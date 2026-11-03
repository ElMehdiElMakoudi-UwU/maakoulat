"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { fmtDays, fmtMoney, fmtNum, today } from "@/lib/format";
import { ADMIN_KINDS, buildReminders, currentMileage, vehicleStats, type Reminder } from "@/lib/fleet";
import TripPlanner from "@/components/fleet/TripPlanner";
import type { Vehicle, VehicleLog, VehicleLogKind } from "@/lib/types";

const fmtDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

const LOG_KINDS: VehicleLogKind[] = ["fuel", "oil", "tires", "brakes", "repair", "other"];
const KIND_ICON: Record<string, string> = {
  fuel: "⛽", oil: "🛢️", tires: "🛞", brakes: "🛑", repair: "🔧", other: "📌",
  insurance: "🛡️", vignette: "🏷️", inspection: "🔍", onssa: "🧪",
};

const EMPTY_VEHICLE = {
  name: "", plate: "", model: "", year: "", fuel_type: "diesel", consumption_l100: "10", mileage_km: "",
  driver: "", insurer: "", insurance_policy: "", insurance_expiry: "", insurance_cost: "",
  vignette_expiry: "", vignette_cost: "", inspection_expiry: "", onssa_number: "", onssa_expiry: "", onssa_cost: "",
  note: "",
};

const EMPTY_LOG = {
  vehicle_id: "", kind: "fuel" as VehicleLogKind, log_date: "", mileage_km: "", cost: "", liters: "",
  next_due_date: "", next_due_km: "", note: "",
};

type Tab = "vehicles" | "logs" | "trip";

export default function FlottePage() {
  const { t, lang } = useI18n();
  const supabase = useMemo(() => createClient(), []);
  const todayStr = today();

  const [loading, setLoading] = useState(true);
  const [missingTable, setMissingTable] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [logs, setLogs] = useState<VehicleLog[]>([]);
  const [marginRate, setMarginRate] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("vehicles");
  const [vForm, setVForm] = useState(EMPTY_VEHICLE);
  const [editingVehicle, setEditingVehicle] = useState<string | null>(null);
  const [showVehicleForm, setShowVehicleForm] = useState(false);
  const [lForm, setLForm] = useState({ ...EMPTY_LOG, log_date: todayStr });
  const [editingLog, setEditingLog] = useState<string | null>(null);
  const [logFilter, setLogFilter] = useState("");

  const load = useCallback(async () => {
    const [v, l] = await Promise.all([
      supabase.from("vehicles").select("*").order("name"),
      supabase.from("vehicle_logs").select("*").order("log_date", { ascending: false }),
    ]);
    if (v.error || l.error) setMissingTable(true);
    else {
      setVehicles((v.data as Vehicle[]) ?? []);
      setLogs((l.data as VehicleLog[]) ?? []);
    }
    setLoading(false);
  }, [supabase]);

  // Marge brute des 90 derniers jours (hors liste de prix « Traiteur »)
  const loadMargin = useCallback(async () => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    const since = d.toISOString().slice(0, 10);
    const { data } = await supabase
      .from("sales")
      .select("quantity,sale_price,purchase_price,products(category)")
      .gte("sale_date", since);
    let ca = 0;
    let margin = 0;
    for (const s of (data ?? []) as unknown as { quantity: number; sale_price: number; purchase_price: number; products: { category: string | null } | null }[]) {
      if (s.products?.category === "Traiteur") continue;
      const q = Number(s.quantity);
      ca += q * Number(s.sale_price);
      margin += q * (Number(s.sale_price) - Number(s.purchase_price));
    }
    setMarginRate(ca > 0 ? (margin / ca) * 100 : null);
  }, [supabase]);

  useEffect(() => {
    load();
    loadMargin();
  }, [load, loadMargin]);

  const byId = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);
  const reminders = useMemo(() => buildReminders(vehicles, logs, todayStr), [vehicles, logs, todayStr]);
  const stats = useMemo(() => new Map(vehicles.map((v) => [v.id, vehicleStats(v.id, logs, todayStr)])), [vehicles, logs, todayStr]);
  const active = vehicles.filter((v) => v.status === "active");
  const overdue = reminders.filter((r) => r.level === "overdue");
  const soon = reminders.filter((r) => r.level === "soon");
  const cost12m = [...stats.values()].reduce((a, s) => a + s.fuel12m + s.maintenance12m, 0);
  const thisMonth = todayStr.slice(0, 7);
  const costThisMonth = logs.filter((l) => l.log_date.slice(0, 7) === thisMonth).reduce((a, l) => a + Number(l.cost), 0);

  // ---------- Véhicules ----------
  const canSaveVehicle = !!(vForm.name.trim() || vForm.plate.trim());
  async function saveVehicle() {
    if (!canSaveVehicle) return;
    const num = (s: string) => (s.trim() === "" ? 0 : Number(s));
    const row = {
      name: vForm.name.trim(), plate: vForm.plate.trim().toUpperCase(), model: vForm.model.trim() || null,
      year: vForm.year ? parseInt(vForm.year) : null, fuel_type: vForm.fuel_type,
      consumption_l100: num(vForm.consumption_l100), mileage_km: Math.round(num(vForm.mileage_km)),
      driver: vForm.driver.trim() || null, insurer: vForm.insurer.trim() || null,
      insurance_policy: vForm.insurance_policy.trim() || null, insurance_expiry: vForm.insurance_expiry || null,
      insurance_cost: num(vForm.insurance_cost), vignette_expiry: vForm.vignette_expiry || null,
      vignette_cost: num(vForm.vignette_cost), inspection_expiry: vForm.inspection_expiry || null,
      onssa_number: vForm.onssa_number.trim() || null, onssa_expiry: vForm.onssa_expiry || null,
      onssa_cost: num(vForm.onssa_cost),
      note: vForm.note.trim() || null,
    };
    if (editingVehicle) await supabase.from("vehicles").update(row).eq("id", editingVehicle);
    else await supabase.from("vehicles").insert(row);
    setVForm(EMPTY_VEHICLE);
    setEditingVehicle(null);
    setShowVehicleForm(false);
    await load();
  }

  function editVehicle(v: Vehicle) {
    setEditingVehicle(v.id);
    setShowVehicleForm(true);
    setVForm({
      name: v.name, plate: v.plate, model: v.model ?? "", year: v.year ? String(v.year) : "", fuel_type: v.fuel_type,
      consumption_l100: String(v.consumption_l100), mileage_km: String(v.mileage_km), driver: v.driver ?? "",
      insurer: v.insurer ?? "", insurance_policy: v.insurance_policy ?? "", insurance_expiry: v.insurance_expiry ?? "",
      insurance_cost: String(v.insurance_cost || ""), vignette_expiry: v.vignette_expiry ?? "",
      vignette_cost: String(v.vignette_cost || ""), inspection_expiry: v.inspection_expiry ?? "",
      onssa_number: v.onssa_number ?? "", onssa_expiry: v.onssa_expiry ?? "", onssa_cost: String(v.onssa_cost || ""),
      note: v.note ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function toggleVehicle(v: Vehicle) {
    await supabase.from("vehicles").update({ status: v.status === "active" ? "inactive" : "active" }).eq("id", v.id);
    await load();
  }

  async function removeVehicle(v: Vehicle) {
    if (!confirm(t("fl_confirm_delete_vehicle"))) return;
    await supabase.from("vehicles").delete().eq("id", v.id);
    await load();
  }

  // ---------- Journal ----------
  const isFuel = lForm.kind === "fuel";
  const canSaveLog = !!lForm.vehicle_id && !!lForm.log_date;
  async function saveLog() {
    if (!canSaveLog) return;
    const opt = (s: string) => (s.trim() === "" ? null : Number(s));
    const km = opt(lForm.mileage_km);
    const row = {
      vehicle_id: lForm.vehicle_id, kind: lForm.kind, log_date: lForm.log_date,
      mileage_km: km != null ? Math.round(km) : null, cost: Number(lForm.cost) || 0,
      liters: isFuel ? opt(lForm.liters) : null,
      next_due_date: !isFuel && lForm.next_due_date ? lForm.next_due_date : null,
      next_due_km: !isFuel ? opt(lForm.next_due_km) : null,
      note: lForm.note.trim() || null,
    };
    if (editingLog) await supabase.from("vehicle_logs").update(row).eq("id", editingLog);
    else await supabase.from("vehicle_logs").insert(row);
    // Le compteur de la fiche suit le dernier relevé
    const v = byId.get(lForm.vehicle_id);
    if (v && row.mileage_km != null && row.mileage_km > Number(v.mileage_km))
      await supabase.from("vehicles").update({ mileage_km: row.mileage_km }).eq("id", v.id);
    setLForm({ ...EMPTY_LOG, vehicle_id: lForm.vehicle_id, kind: lForm.kind, log_date: todayStr });
    setEditingLog(null);
    await load();
  }

  function editLog(l: VehicleLog) {
    setEditingLog(l.id);
    setLForm({
      vehicle_id: l.vehicle_id, kind: l.kind, log_date: l.log_date, mileage_km: l.mileage_km != null ? String(l.mileage_km) : "",
      cost: String(l.cost || ""), liters: l.liters != null ? String(l.liters) : "",
      next_due_date: l.next_due_date ?? "", next_due_km: l.next_due_km != null ? String(l.next_due_km) : "", note: l.note ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function removeLog(l: VehicleLog) {
    if (!confirm(t("confirm_delete"))) return;
    await supabase.from("vehicle_logs").delete().eq("id", l.id);
    await load();
  }

  // Raccourci depuis un rappel : prépare la saisie de l'entretien correspondant
  function handleReminder(r: Reminder) {
    const v = byId.get(r.vehicleId);
    if (!v) return;
    if (ADMIN_KINDS.includes(r.kind)) {
      setTab("vehicles");
      editVehicle(v);
    } else {
      setTab("logs");
      setEditingLog(null);
      setLForm({ ...EMPTY_LOG, vehicle_id: v.id, kind: r.kind as VehicleLogKind, log_date: todayStr, mileage_km: String(currentMileage(v, logs)) });
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  const vehicleName = (id: string) => {
    const v = byId.get(id);
    return v ? [v.name, v.plate].filter(Boolean).join(" · ") : "—";
  };

  function reminderText(r: Reminder) {
    const parts: string[] = [];
    if (r.daysLeft != null)
      parts.push(r.daysLeft < 0 ? `${t("fl_late_by")} ${fmtDays(-r.daysLeft, lang)}` : r.daysLeft === 0 ? t("fl_today") : `${t("fl_in")} ${fmtDays(r.daysLeft, lang)}`);
    if (r.kmLeft != null)
      parts.push(r.kmLeft < 0 ? `${t("fl_km_over")} ${fmtNum(-r.kmLeft, lang)} km` : `${t("fl_in")} ${fmtNum(r.kmLeft, lang)} km`);
    return parts.join(" · ");
  }

  if (loading) return <p className="p-8 text-center text-muted">{t("loading")}</p>;

  if (missingTable) {
    return (
      <div>
        <h1 className="mb-4 text-2xl font-bold">{t("fl_title")}</h1>
        <div className="rounded-xl border border-accent/40 bg-accent/5 px-4 py-3 text-sm">{t("fl_missing_table")}</div>
      </div>
    );
  }

  const urgent = [...overdue, ...soon];
  const shownLogs = logFilter ? logs.filter((l) => l.vehicle_id === logFilter) : logs;

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold">{t("fl_title")}</h1>
        <p className="text-sm text-muted">{t("fl_subtitle")}</p>
      </div>

      {/* KPI */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("fl_active_vehicles")} value={String(active.length)} sub={`${vehicles.length} ${t("fl_total")}`} />
        <Kpi label={t("fl_overdue")} value={String(overdue.length)} sub={t("fl_reminders")} accent={overdue.length ? "danger" : "success"} />
        <Kpi label={t("fl_due_soon")} value={String(soon.length)} sub={t("fl_within_30")} accent={soon.length ? "accent" : undefined} />
        <Kpi label={t("fl_cost_month")} value={fmtMoney(costThisMonth, lang)} sub={`${t("fl_12_months")} : ${fmtMoney(cost12m, lang)}`} />
      </div>

      {/* Rappels urgents */}
      {urgent.length > 0 && (
        <div className="card mb-5 p-4">
          <h2 className="mb-2 font-bold">🔔 {t("fl_reminders")}</h2>
          <div className="flex flex-col divide-y divide-border">
            {urgent.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${r.level === "overdue" ? "bg-danger" : "bg-accent"}`} />
                <span>{KIND_ICON[r.kind]} <b>{t(`fl_kind_${r.kind}`)}</b></span>
                {r.step != null && <StepBadge step={r.step} />}
                <span className="text-muted">{vehicleName(r.vehicleId)}</span>
                <span className={r.level === "overdue" ? "font-semibold text-danger" : "text-accent"}>{reminderText(r)}</span>
                {r.dueDate && <span className="text-xs text-muted"><bdi dir="ltr">{fmtDate(r.dueDate)}</bdi></span>}
                <button onClick={() => handleReminder(r)} className="ms-auto text-xs text-primary hover:underline">
                  {ADMIN_KINDS.includes(r.kind) ? t("fl_renew") : t("fl_record_done")}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Onglets */}
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
        {(["vehicles", "logs", "trip"] as Tab[]).map((k) => (
          <button key={k} onClick={() => setTab(k)}
            className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium ${tab === k ? "border-primary text-primary" : "border-transparent text-muted hover:text-foreground"}`}>
            {t(`fl_tab_${k}`)}
          </button>
        ))}
      </div>

      {tab === "vehicles" && (
        <div className="flex flex-col gap-5">
          {!showVehicleForm ? (
            <div>
              <button onClick={() => { setShowVehicleForm(true); setEditingVehicle(null); setVForm(EMPTY_VEHICLE); }}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg">
                + {t("fl_add_vehicle")}
              </button>
            </div>
          ) : (
            <div className="card p-4">
              <h2 className="mb-3 font-bold">{editingVehicle ? t("fl_edit_vehicle") : t("fl_add_vehicle")}</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label={t("fl_name")}><input className="input" value={vForm.name} onChange={(e) => setVForm({ ...vForm, name: e.target.value })} placeholder="Camion Isuzu" /></Field>
                <Field label={t("fl_plate")}><input className="input" value={vForm.plate} onChange={(e) => setVForm({ ...vForm, plate: e.target.value })} /></Field>
                <Field label={t("fl_model")}><input className="input" value={vForm.model} onChange={(e) => setVForm({ ...vForm, model: e.target.value })} /></Field>
                <Field label={t("fl_year")}><input type="number" className="input" value={vForm.year} onChange={(e) => setVForm({ ...vForm, year: e.target.value })} /></Field>
                <Field label={t("fl_fuel_type")}>
                  <select className="input" value={vForm.fuel_type} onChange={(e) => setVForm({ ...vForm, fuel_type: e.target.value })}>
                    <option value="diesel">{t("fl_diesel")}</option>
                    <option value="essence">{t("fl_essence")}</option>
                  </select>
                </Field>
                <Field label={t("fl_consumption")}><input type="number" min={0} step={0.1} className="input" value={vForm.consumption_l100} onChange={(e) => setVForm({ ...vForm, consumption_l100: e.target.value })} /></Field>
                <Field label={t("fl_mileage")}><input type="number" min={0} className="input" value={vForm.mileage_km} onChange={(e) => setVForm({ ...vForm, mileage_km: e.target.value })} /></Field>
                <Field label={t("fl_driver")}><input className="input" value={vForm.driver} onChange={(e) => setVForm({ ...vForm, driver: e.target.value })} /></Field>

                <div className="mt-2 text-sm font-semibold text-muted sm:col-span-2 lg:col-span-4">🛡️ {t("fl_kind_insurance")} · 🏷️ {t("fl_kind_vignette")} · 🔍 {t("fl_kind_inspection")} · 🧪 {t("fl_kind_onssa")}</div>
                <Field label={t("fl_insurer")}><input className="input" value={vForm.insurer} onChange={(e) => setVForm({ ...vForm, insurer: e.target.value })} /></Field>
                <Field label={t("fl_policy")}><input className="input" value={vForm.insurance_policy} onChange={(e) => setVForm({ ...vForm, insurance_policy: e.target.value })} /></Field>
                <Field label={t("fl_insurance_expiry")}><input type="date" className="input" value={vForm.insurance_expiry} onChange={(e) => setVForm({ ...vForm, insurance_expiry: e.target.value })} /></Field>
                <Field label={t("fl_insurance_cost")}><input type="number" min={0} className="input" value={vForm.insurance_cost} onChange={(e) => setVForm({ ...vForm, insurance_cost: e.target.value })} /></Field>
                <Field label={t("fl_vignette_expiry")}><input type="date" className="input" value={vForm.vignette_expiry} onChange={(e) => setVForm({ ...vForm, vignette_expiry: e.target.value })} /></Field>
                <Field label={t("fl_vignette_cost")}><input type="number" min={0} className="input" value={vForm.vignette_cost} onChange={(e) => setVForm({ ...vForm, vignette_cost: e.target.value })} /></Field>
                <Field label={t("fl_inspection_expiry")}><input type="date" className="input" value={vForm.inspection_expiry} onChange={(e) => setVForm({ ...vForm, inspection_expiry: e.target.value })} /></Field>
                <Field label={t("fl_onssa_number")}><input className="input" value={vForm.onssa_number} onChange={(e) => setVForm({ ...vForm, onssa_number: e.target.value })} /></Field>
                <Field label={t("fl_onssa_expiry")}>
                  <input type="date" className="input" value={vForm.onssa_expiry} onChange={(e) => setVForm({ ...vForm, onssa_expiry: e.target.value })} />
                  <div className="mt-1 text-xs text-muted">{t("fl_onssa_hint")}</div>
                </Field>
                <Field label={t("fl_onssa_cost")}><input type="number" min={0} className="input" value={vForm.onssa_cost} onChange={(e) => setVForm({ ...vForm, onssa_cost: e.target.value })} /></Field>
                <Field label={t("note")}><input className="input" value={vForm.note} onChange={(e) => setVForm({ ...vForm, note: e.target.value })} /></Field>
              </div>
              <div className="mt-4 flex gap-2">
                <button onClick={saveVehicle} disabled={!canSaveVehicle}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg disabled:opacity-50">
                  {editingVehicle ? t("save") : t("add")}
                </button>
                <button onClick={() => { setShowVehicleForm(false); setEditingVehicle(null); setVForm(EMPTY_VEHICLE); }}
                  className="rounded-lg border border-border px-4 py-2 text-sm">{t("cancel")}</button>
              </div>
            </div>
          )}

          {vehicles.length === 0 ? (
            <p className="card p-6 text-center text-sm text-muted">{t("fl_no_vehicles")}</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {vehicles.map((v) => {
                const s = stats.get(v.id)!;
                const vr = reminders.filter((r) => r.vehicleId === v.id);
                return (
                  <div key={v.id} className={`card p-4 ${v.status === "inactive" ? "opacity-60" : ""}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-lg font-bold">🚚 {v.name || v.plate}</div>
                        <div className="text-sm text-muted">
                          {[v.plate, v.model, v.year, t(v.fuel_type === "diesel" ? "fl_diesel" : "fl_essence")].filter(Boolean).join(" · ")}
                        </div>
                        {v.driver && <div className="text-sm">👤 {v.driver}</div>}
                      </div>
                      <div className="text-end text-sm">
                        <div className="font-semibold"><bdi dir="ltr">{fmtNum(currentMileage(v, logs), lang)} km</bdi></div>
                        <div className="text-xs text-muted">{fmtNum(Number(v.consumption_l100), lang)} L/100
                          {s.realConsumption != null && <> · {t("fl_real")} {fmtNum(Math.round(s.realConsumption * 10) / 10, lang)}</>}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-col gap-1 text-sm">
                      {vr.length === 0 && <div className="text-xs text-muted">{t("fl_no_reminders")}</div>}
                      {vr.map((r, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${r.level === "overdue" ? "bg-danger" : r.level === "soon" ? "bg-accent" : "bg-success"}`} />
                          <span className="flex-1">{KIND_ICON[r.kind]} {t(`fl_kind_${r.kind}`)} {r.step != null && <StepBadge step={r.step} />}</span>
                          <span className={`text-xs ${r.level === "overdue" ? "text-danger" : r.level === "soon" ? "text-accent" : "text-muted"}`}>
                            {r.dueDate ? <bdi dir="ltr">{fmtDate(r.dueDate)}</bdi> : null}
                            {r.dueDate && r.dueKm != null ? " · " : ""}
                            {r.dueKm != null ? <bdi dir="ltr">{fmtNum(r.dueKm, lang)} km</bdi> : null}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-background p-2 text-center text-xs">
                      <div><div className="text-muted">{t("fl_fuel_12m")}</div><div className="font-semibold">{fmtMoney(Math.round(s.fuel12m), lang)}</div></div>
                      <div><div className="text-muted">{t("fl_maintenance_12m")}</div><div className="font-semibold">{fmtMoney(Math.round(s.maintenance12m), lang)}</div></div>
                      <div><div className="text-muted">{t("fl_cost_per_km")}</div><div className="font-semibold">{s.costPerKm != null ? fmtMoney(s.costPerKm, lang) : "—"}</div></div>
                    </div>
                    {v.insurer && <div className="mt-2 text-xs text-muted">🛡️ {v.insurer}{v.insurance_policy && ` · ${v.insurance_policy}`}{Number(v.insurance_cost) > 0 && ` · ${fmtMoney(Number(v.insurance_cost), lang)}/${t("fl_year_short")}`}</div>}
                    {v.onssa_number && <div className="mt-1 text-xs text-muted">🧪 ONSSA · {v.onssa_number}{Number(v.onssa_cost) > 0 && ` · ${fmtMoney(Number(v.onssa_cost), lang)}/${t("fl_year_short")}`}</div>}
                    {v.note && <div className="mt-1 text-xs text-muted">{v.note}</div>}

                    <div className="mt-3 flex flex-wrap gap-3 text-xs">
                      <button onClick={() => { setTab("logs"); setLogFilter(v.id); setLForm({ ...EMPTY_LOG, vehicle_id: v.id, log_date: todayStr }); }}
                        className="text-primary hover:underline">{t("fl_journal")}</button>
                      <button onClick={() => editVehicle(v)} className="hover:underline">{t("edit")}</button>
                      <button onClick={() => toggleVehicle(v)} className="text-muted hover:underline">
                        {v.status === "active" ? t("fl_deactivate") : t("fl_activate")}
                      </button>
                      <button onClick={() => removeVehicle(v)} className="text-danger hover:underline">{t("delete")}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "logs" && (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="card p-4 lg:col-span-1">
            <h2 className="mb-3 font-bold">{editingLog ? t("fl_edit_entry") : t("fl_add_entry")}</h2>
            {vehicles.length === 0 ? (
              <p className="text-sm text-muted">{t("fl_no_vehicles")}</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Field label={t("fl_vehicle")}>
                    <select className="input" value={lForm.vehicle_id} onChange={(e) => setLForm({ ...lForm, vehicle_id: e.target.value })}>
                      <option value="">—</option>
                      {vehicles.map((v) => <option key={v.id} value={v.id}>{vehicleName(v.id)}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label={t("fl_type")}>
                    <div className="flex flex-wrap gap-1.5">
                      {LOG_KINDS.map((k) => (
                        <button key={k} onClick={() => setLForm({ ...lForm, kind: k })}
                          className={`rounded-full border px-2.5 py-1 text-xs ${lForm.kind === k ? "border-primary bg-primary text-primary-fg" : "border-border"}`}>
                          {KIND_ICON[k]} {t(`fl_kind_${k}`)}
                        </button>
                      ))}
                    </div>
                  </Field>
                </div>
                <Field label={t("date")}><input type="date" className="input" value={lForm.log_date} onChange={(e) => setLForm({ ...lForm, log_date: e.target.value })} /></Field>
                <Field label={t("fl_mileage")}><input type="number" min={0} className="input" value={lForm.mileage_km} onChange={(e) => setLForm({ ...lForm, mileage_km: e.target.value })} /></Field>
                <Field label={t("amount")}><input type="number" min={0} className="input" value={lForm.cost} onChange={(e) => setLForm({ ...lForm, cost: e.target.value })} /></Field>
                {isFuel ? (
                  <Field label={t("fl_liters")}><input type="number" min={0} step={0.01} className="input" value={lForm.liters} onChange={(e) => setLForm({ ...lForm, liters: e.target.value })} /></Field>
                ) : (
                  <>
                    <div className="sm:col-span-2 text-xs font-semibold text-muted">🔔 {t("fl_next_due")}</div>
                    <Field label={t("fl_next_due_date")}><input type="date" className="input" value={lForm.next_due_date} onChange={(e) => setLForm({ ...lForm, next_due_date: e.target.value })} /></Field>
                    <Field label={t("fl_next_due_km")}>
                      <input type="number" min={0} className="input" value={lForm.next_due_km} onChange={(e) => setLForm({ ...lForm, next_due_km: e.target.value })} />
                      {lForm.kind === "oil" && lForm.mileage_km && (
                        <button onClick={() => setLForm({ ...lForm, next_due_km: String(Number(lForm.mileage_km) + 10000) })} className="mt-1 text-xs text-primary hover:underline">
                          +10 000 km
                        </button>
                      )}
                    </Field>
                  </>
                )}
                <div className="sm:col-span-2">
                  <Field label={t("note")}><input className="input" value={lForm.note} onChange={(e) => setLForm({ ...lForm, note: e.target.value })} /></Field>
                </div>
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <button onClick={saveLog} disabled={!canSaveLog}
                className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg disabled:opacity-50">
                {editingLog ? t("save") : t("add")}
              </button>
              {editingLog && (
                <button onClick={() => { setEditingLog(null); setLForm({ ...EMPTY_LOG, log_date: todayStr }); }}
                  className="rounded-lg border border-border px-4 py-2 text-sm">{t("cancel")}</button>
              )}
            </div>
          </div>

          <div className="card overflow-x-auto lg:col-span-2">
            <div className="flex items-center justify-between gap-2 px-4 pt-4">
              <h2 className="font-bold">{t("fl_journal")}</h2>
              <select className="input max-w-56" value={logFilter} onChange={(e) => setLogFilter(e.target.value)}>
                <option value="">{t("fl_all_vehicles")}</option>
                {vehicles.map((v) => <option key={v.id} value={v.id}>{vehicleName(v.id)}</option>)}
              </select>
            </div>
            {shownLogs.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted">{t("fl_no_entries")}</p>
            ) : (
              <table className="mt-2 w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-muted">
                    <th className="px-4 py-2 text-start font-medium">{t("date")}</th>
                    <th className="px-4 py-2 text-start font-medium">{t("fl_type")}</th>
                    <th className="px-4 py-2 text-start font-medium">{t("fl_vehicle")}</th>
                    <th className="px-4 py-2 text-end font-medium">km</th>
                    <th className="px-4 py-2 text-end font-medium">{t("amount")}</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {shownLogs.map((l) => (
                    <tr key={l.id}>
                      <td className="px-4 py-2"><bdi dir="ltr">{fmtDate(l.log_date)}</bdi></td>
                      <td className="px-4 py-2">
                        {KIND_ICON[l.kind]} {t(`fl_kind_${l.kind}`)}
                        <div className="text-xs text-muted">
                          {l.liters != null && <>{fmtNum(Number(l.liters), lang)} L · </>}
                          {(l.next_due_date || l.next_due_km != null) && (
                            <>🔔 {l.next_due_date && <bdi dir="ltr">{fmtDate(l.next_due_date)}</bdi>}
                              {l.next_due_date && l.next_due_km != null && " / "}
                              {l.next_due_km != null && <bdi dir="ltr">{fmtNum(l.next_due_km, lang)} km</bdi>} · </>
                          )}
                          {l.note}
                        </div>
                      </td>
                      <td className="px-4 py-2">{vehicleName(l.vehicle_id)}</td>
                      <td className="px-4 py-2 text-end">{l.mileage_km != null ? fmtNum(l.mileage_km, lang) : "—"}</td>
                      <td className="px-4 py-2 text-end font-semibold">{fmtMoney(Number(l.cost), lang)}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-end">
                        <button onClick={() => editLog(l)} className="me-3 text-xs hover:underline">{t("edit")}</button>
                        <button onClick={() => removeLog(l)} className="text-xs text-danger hover:underline">{t("delete")}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === "trip" && <TripPlanner vehicles={vehicles} stats={stats} salesMarginRate={marginRate} />}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

// Palier de rappel ONSSA : J-30 / J-15 / J-7 / veille / expiré
function StepBadge({ step }: { step: number | "late" }) {
  const { t } = useI18n();
  const label = step === "late" ? t("fl_step_late") : step === 0 ? t("fl_today") : step === 1 ? t("fl_step_eve") : `J-${step}`;
  const tone = step === "late" || step <= 1 ? "bg-danger text-white" : step === 7 ? "bg-accent text-black" : "bg-accent/20 text-foreground";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${tone}`}><bdi dir="ltr">{label}</bdi></span>;
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "success" | "danger" | "accent" }) {
  const color = accent === "success" ? "text-success" : accent === "danger" ? "text-danger" : accent === "accent" ? "text-accent" : "text-foreground";
  return (
    <div className="card p-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={`mt-1 text-xl font-bold ${color}`}>{value}</div>
      {sub && <div className="truncate text-xs text-muted">{sub}</div>}
    </div>
  );
}
