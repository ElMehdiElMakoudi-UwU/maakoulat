import type { Vehicle, VehicleLog, VehicleLogKind } from "./types";

/** Dépôt de départ des tournées (siège à Ksar El Kebir). */
export const DEPOT = { name: "Dépôt Ksar El Kebir", lat: 35.0017, lng: -5.9046 };

/** Villes de la zone Tanger–Tétouan pour ajouter un arrêt en un clic. */
export const PLACES: { name: string; lat: number; lng: number }[] = [
  { name: "Tanger", lat: 35.7595, lng: -5.834 },
  { name: "Tétouan", lat: 35.5785, lng: -5.3684 },
  { name: "Asilah", lat: 35.4652, lng: -6.0341 },
  { name: "Larache", lat: 35.1932, lng: -6.1557 },
  { name: "M'diq", lat: 35.6858, lng: -5.3253 },
  { name: "Martil", lat: 35.6167, lng: -5.275 },
  { name: "Fnideq", lat: 35.8492, lng: -5.3571 },
  { name: "Ksar Sghir", lat: 35.8433, lng: -5.5594 },
  { name: "Chefchaouen", lat: 35.1688, lng: -5.2636 },
  { name: "Ouezzane", lat: 34.7975, lng: -5.5788 },
];

/** Prix au litre par défaut (DH) — modifiables dans le simulateur. */
export const DEFAULT_FUEL_PRICE = { diesel: 11, essence: 13 };

// Une échéance est « bientôt » à moins de 30 jours ou 1 000 km
const SOON_DAYS = 30;
const SOON_KM = 1000;

export const MAINTENANCE_KINDS: VehicleLogKind[] = ["oil", "tires", "brakes", "repair", "other"];

export type ReminderKind = "insurance" | "vignette" | "inspection" | "onssa" | VehicleLogKind;

/** Échéances portées par la fiche véhicule (renouvelées en modifiant la fiche). */
export const ADMIN_KINDS: ReminderKind[] = ["insurance", "vignette", "inspection", "onssa"];

/**
 * Paliers de rappel ONSSA : J-30, J-15, J-7, la veille (J-1), puis le lendemain
 * de l'échéance et au-delà (en retard). Renvoie le palier atteint, ou null
 * s'il reste plus de 30 jours.
 */
export const ONSSA_STEPS = [30, 15, 7, 1];
export function onssaStep(daysLeft: number): number | "late" | null {
  if (daysLeft < 0) return "late";
  if (daysLeft === 0) return 0; // jour de l'échéance
  for (const step of [...ONSSA_STEPS].reverse()) if (daysLeft <= step) return step;
  return null;
}
export type ReminderLevel = "overdue" | "soon" | "ok";

export interface Reminder {
  vehicleId: string;
  kind: ReminderKind;
  dueDate: string | null;
  dueKm: number | null;
  daysLeft: number | null;
  kmLeft: number | null;
  level: ReminderLevel;
  step?: number | "late" | null; // palier ONSSA atteint
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

function levelOf(daysLeft: number | null, kmLeft: number | null): ReminderLevel {
  if ((daysLeft != null && daysLeft < 0) || (kmLeft != null && kmLeft < 0)) return "overdue";
  if ((daysLeft != null && daysLeft <= SOON_DAYS) || (kmLeft != null && kmLeft <= SOON_KM)) return "soon";
  return "ok";
}

/**
 * Rappels des véhicules actifs : échéances administratives de la fiche, puis
 * pour chaque type d'entretien la dernière ligne du journal qui porte une
 * prochaine échéance (date et/ou km). Triés du plus urgent au moins urgent.
 */
export function buildReminders(vehicles: Vehicle[], logs: VehicleLog[], today: string): Reminder[] {
  const out: Reminder[] = [];
  const latest = new Map<string, VehicleLog>();
  for (const l of logs) {
    if (l.kind === "fuel") continue;
    const key = `${l.vehicle_id}|${l.kind}`;
    const prev = latest.get(key);
    if (!prev || l.log_date > prev.log_date || (l.log_date === prev.log_date && (l.created_at ?? "") > (prev.created_at ?? "")))
      latest.set(key, l);
  }

  for (const v of vehicles) {
    if (v.status !== "active") continue;
    const admin: [ReminderKind, string | null][] = [
      ["insurance", v.insurance_expiry],
      ["vignette", v.vignette_expiry],
      ["inspection", v.inspection_expiry],
      ["onssa", v.onssa_expiry],
    ];
    for (const [kind, date] of admin) {
      if (!date) continue;
      const daysLeft = daysBetween(today, date);
      out.push({
        vehicleId: v.id, kind, dueDate: date, dueKm: null, daysLeft, kmLeft: null, level: levelOf(daysLeft, null),
        ...(kind === "onssa" ? { step: onssaStep(daysLeft) } : {}),
      });
    }
    for (const kind of MAINTENANCE_KINDS) {
      const l = latest.get(`${v.id}|${kind}`);
      if (!l || (!l.next_due_date && l.next_due_km == null)) continue;
      const daysLeft = l.next_due_date ? daysBetween(today, l.next_due_date) : null;
      const kmLeft = l.next_due_km != null ? l.next_due_km - currentMileage(v, logs) : null;
      out.push({ vehicleId: v.id, kind, dueDate: l.next_due_date, dueKm: l.next_due_km, daysLeft, kmLeft, level: levelOf(daysLeft, kmLeft) });
    }
  }

  const rank = { overdue: 0, soon: 1, ok: 2 };
  // Urgence approchée : jours restants, ou km restants ramenés à ~100 km/jour
  const urgency = (r: Reminder) => Math.min(r.daysLeft ?? Infinity, r.kmLeft != null ? r.kmLeft / 100 : Infinity);
  return out.sort((a, b) => rank[a.level] - rank[b.level] || urgency(a) - urgency(b));
}

/** Compteur : le plus grand entre la fiche et le dernier relevé du journal. */
export function currentMileage(v: Vehicle, logs: VehicleLog[]): number {
  let km = Number(v.mileage_km) || 0;
  for (const l of logs) if (l.vehicle_id === v.id && l.mileage_km != null && l.mileage_km > km) km = l.mileage_km;
  return km;
}

export interface VehicleStats {
  realConsumption: number | null; // L/100 km mesurée sur les pleins
  costPerKm: number | null;       // entretien + carburant sur 12 mois, DH/km
  maintenancePerKm: number | null; // entretien seul sur 12 mois, DH/km
  fuel12m: number;
  maintenance12m: number;
  km12m: number | null;
}

/** Statistiques sur les 12 derniers mois du journal d'un véhicule. */
export function vehicleStats(vehicleId: string, logs: VehicleLog[], today: string): VehicleStats {
  const since = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  const mine = logs.filter((l) => l.vehicle_id === vehicleId && l.log_date >= since);
  const fuel12m = mine.filter((l) => l.kind === "fuel").reduce((a, l) => a + Number(l.cost), 0);
  const maintenance12m = mine.filter((l) => l.kind !== "fuel").reduce((a, l) => a + Number(l.cost), 0);

  const kms = mine.map((l) => l.mileage_km).filter((k): k is number => k != null);
  const km12m = kms.length >= 2 ? Math.max(...kms) - Math.min(...kms) : null;

  // Conso réelle : litres des pleins (sauf le premier, qui remplit un réservoir
  // d'avant la période) rapportés aux km entre le premier et le dernier plein.
  const fills = mine
    .filter((l) => l.kind === "fuel" && l.mileage_km != null && l.liters != null)
    .sort((a, b) => a.mileage_km! - b.mileage_km!);
  let realConsumption: number | null = null;
  if (fills.length >= 2) {
    const dist = fills[fills.length - 1].mileage_km! - fills[0].mileage_km!;
    const liters = fills.slice(1).reduce((a, l) => a + Number(l.liters), 0);
    if (dist > 0) realConsumption = (liters / dist) * 100;
  }

  return {
    realConsumption,
    costPerKm: km12m ? (fuel12m + maintenance12m) / km12m : null,
    maintenancePerKm: km12m ? maintenance12m / km12m : null,
    fuel12m,
    maintenance12m,
    km12m,
  };
}

/** Frais fixes mensuels d'un véhicule (assurance + vignette + ONSSA ramenées au mois). */
export function vehicleMonthlyFixed(v: Vehicle): number {
  return (Number(v.insurance_cost) + Number(v.vignette_cost) + Number(v.onssa_cost || 0)) / 12;
}

export function fuelLiters(distanceKm: number, l100: number): number {
  return (distanceKm * l100) / 100;
}

export interface BreakEvenInput {
  tripsPerMonth: number;
  distancePerTrip: number;     // km aller-retour
  fuelCostPerTrip: number;
  tollsPerTrip: number;
  otherPerTrip: number;        // repas chauffeur, parking…
  maintenancePerKm: number;
  vehicleFixedMonthly: number; // assurance + vignette si véhicule dédié
  staffMonthly: number;        // chauffeur, livreur, commercial
  otherFixedMonthly: number;   // dépôt, téléphone, marketing…
  marginRate: number;          // marge brute en % du CA HT
  targetProfit: number;        // bénéfice mensuel visé
}

export interface BreakEvenResult {
  variableMonthly: number;
  fixedMonthly: number;
  totalMonthly: number;
  breakEvenSales: number;  // CA HT mensuel pour couvrir les frais
  targetSales: number;     // CA HT mensuel pour atteindre le bénéfice visé
  salesPerTrip: number;    // CA HT par tournée pour l'objectif
  costPerTrip: number;     // coût complet d'une tournée
  kmPerMonth: number;
}

export function breakEven(i: BreakEvenInput): BreakEvenResult {
  const kmPerMonth = i.tripsPerMonth * i.distancePerTrip;
  const variableMonthly =
    i.tripsPerMonth * (i.fuelCostPerTrip + i.tollsPerTrip + i.otherPerTrip) + kmPerMonth * i.maintenancePerKm;
  const fixedMonthly = i.vehicleFixedMonthly + i.staffMonthly + i.otherFixedMonthly;
  const totalMonthly = variableMonthly + fixedMonthly;
  const m = i.marginRate / 100;
  const breakEvenSales = m > 0 ? totalMonthly / m : Infinity;
  const targetSales = m > 0 ? (totalMonthly + i.targetProfit) / m : Infinity;
  return {
    variableMonthly,
    fixedMonthly,
    totalMonthly,
    breakEvenSales,
    targetSales,
    salesPerTrip: i.tripsPerMonth > 0 ? targetSales / i.tripsPerMonth : 0,
    costPerTrip: i.tripsPerMonth > 0 ? totalMonthly / i.tripsPerMonth : 0,
    kmPerMonth,
  };
}

export interface RouteResult {
  distanceKm: number;
  durationMin: number;
  coords: [number, number][]; // [lat, lng]
}

/** Itinéraire routier via le serveur public OSRM (sans clé). */
export async function fetchRoute(points: { lat: number; lng: number }[]): Promise<RouteResult> {
  const path = points.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(";");
  const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${path}?overview=full&geometries=geojson`);
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const data = await res.json();
  const r = data.routes?.[0];
  if (!r) throw new Error("no route");
  return {
    distanceKm: r.distance / 1000,
    durationMin: r.duration / 60,
    coords: (r.geometry.coordinates as [number, number][]).map(([lng, lat]) => [lat, lng]),
  };
}

/** Recherche d'adresse / lieu au Maroc via Nominatim (OpenStreetMap). */
export async function searchPlace(q: string): Promise<{ name: string; lat: number; lng: number }[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=ma&limit=5&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { "Accept-Language": "fr" } });
  if (!res.ok) return [];
  const data = (await res.json()) as { display_name: string; lat: string; lon: string }[];
  return data.map((d) => ({ name: d.display_name.split(",").slice(0, 2).join(","), lat: Number(d.lat), lng: Number(d.lon) }));
}
