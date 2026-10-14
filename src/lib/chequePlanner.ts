import { addDays, daysBetween } from "./supplierDues";
import { weekday } from "./treasuryForecast";

// Planification des chèques fournisseurs post-datés.
//
// Modèle (celui fait « à la main ») : chaque jour ouvré, les vendeurs
// rapportent leur CA/J ; cet argent sert à couvrir les chèques en circulation.
// Convention d'une journée d :
//   1. le matin, les chèques datés de d sont débités → le solde doit rester ≥ marge
//   2. dans la journée, les vendeurs encaissent → le solde augmente du CA/J
// Les encaissements commencent demain (l'argent déjà en caisse aujourd'hui
// est saisi comme « liquidités disponibles »).

export interface ChequePlannerSettings {
  /** CA/J saisi manuellement par vendeur (sinon : calculé sur l'historique) */
  rates: Record<string, number>;
  /** Vendeurs dont l'encaissement sert à payer les chèques */
  included: Record<string, boolean>;
  /** Jours sans encaissement (0 = dimanche) */
  restDays: number[];
  /** Part du CA réellement disponible pour les chèques (%) */
  availablePct: number;
  /** Solde minimum à garder après chaque débit (DH) */
  buffer: number;
}

export const DEFAULT_PLANNER_SETTINGS: ChequePlannerSettings = {
  rates: {},
  included: {},
  restDays: [0],
  availablePct: 100,
  buffer: 0,
};

export const PLANNER_SETTINGS_KEY = "cheque_planner";

export interface PlannedCheque {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
}

export interface PlanDay {
  date: string;
  out: number; // chèques débités le matin
  checkpoint: number; // solde juste après les débits du matin
  inflow: number; // encaissements de la journée
  balance: number; // solde en fin de journée
}

export interface PlanInput {
  today: string;
  startCash: number;
  dailyRate: number; // encaissement d'un jour ouvré, déjà multiplié par la part disponible
  restDays: number[];
  cheques: PlannedCheque[];
}

/** Encaissement attendu un jour donné */
export function inflowOn(date: string, today: string, dailyRate: number, restDays: number[]): number {
  if (date <= today) return 0;
  return restDays.includes(weekday(date)) ? 0 : dailyRate;
}

/** Jours ouvrés d'un mois 'YYYY-MM' (ex. 26 si seul le dimanche est chômé) */
export function workingDaysInMonth(month: string, restDays: number[]): number {
  const [y, m] = month.split("-").map(Number);
  const n = new Date(y, m, 0).getDate();
  let count = 0;
  for (let d = 1; d <= n; d++) {
    if (!restDays.includes(weekday(`${month}-${String(d).padStart(2, "0")}`))) count++;
  }
  return count;
}

/** Date effective de débit : un chèque daté d'avant aujourd'hui est dû aujourd'hui */
const effDate = (c: PlannedCheque, today: string) => (c.date < today ? today : c.date);

/** Simulation jour par jour de today à `until` inclus */
export function simulate(input: PlanInput, until: string): PlanDay[] {
  const { today, startCash, dailyRate, restDays, cheques } = input;
  const outByDate = new Map<string, number>();
  for (const c of cheques) {
    const d = effDate(c, today);
    outByDate.set(d, (outByDate.get(d) ?? 0) + c.amount);
  }
  const days: PlanDay[] = [];
  let bal = startCash;
  for (let d = today; d <= until; d = addDays(d, 1)) {
    const out = outByDate.get(d) ?? 0;
    const checkpoint = bal - out;
    const inflow = inflowOn(d, today, dailyRate, restDays);
    bal = checkpoint + inflow;
    days.push({ date: d, out, checkpoint, inflow, balance: bal });
  }
  return days;
}

/** Dernière date de chèque en circulation (au moins aujourd'hui) */
export function lastChequeDate(cheques: PlannedCheque[], today: string): string {
  return cheques.reduce((m, c) => (effDate(c, today) > m ? effDate(c, today) : m), today);
}

/**
 * Méthode manuelle : après le dernier chèque, compter les jours ouvrés
 * nécessaires pour réunir le montant (ex. 25 000 DH à 7 000 DH/j → 4 jours).
 */
export function manualDate(input: PlanInput, amount: number): string | null {
  const { today, dailyRate, restDays, cheques } = input;
  if (dailyRate <= 0) return null;
  const last = lastChequeDate(cheques, today);
  let needed = Math.ceil(amount / dailyRate - 1e-9);
  let d = last;
  // Le jour du dernier chèque compte s'il est ouvré (encaissement après le débit)
  if (inflowOn(d, today, dailyRate, restDays) > 0) needed--;
  while (needed > 0) {
    d = addDays(d, 1);
    if (inflowOn(d, today, dailyRate, restDays) > 0) needed--;
  }
  return addDays(d, 1);
}

export interface Suggestion {
  date: string;
  /** Solde le plus bas, à partir de cette date, une fois le chèque ajouté */
  margin: number;
  /** Date du point le plus bas */
  tightest: string;
  /** Date selon la méthode « après le dernier chèque » */
  manual: string | null;
  /** Le chèque se glisse avant le dernier chèque existant */
  squeezed: boolean;
}

const MAX_SEARCH_DAYS = 400;

/**
 * Première date (≥ notBefore) où l'on peut dater un chèque de `amount` sans que
 * le solde passe sous `buffer`, ni ce jour-là ni à l'échéance d'un chèque suivant.
 * Ajouter un chèque le jour D baisse tous les points de contrôle t ≥ D :
 * il faut donc min_{t ≥ D} checkpoint(t) − amount ≥ buffer.
 */
export function suggestDate(input: PlanInput, amount: number, buffer: number, notBefore?: string): Suggestion | null {
  const { today, dailyRate } = input;
  const last = lastChequeDate(input.cheques, today);
  const start = notBefore && notBefore > today ? notBefore : today;
  // Au-delà du dernier chèque, le solde ne fait que monter : on simule jusqu'à
  // ce que la condition soit remplie ou que la recherche devienne absurde.
  const until = addDays(last > start ? last : start, MAX_SEARCH_DAYS);
  const days = simulate(input, until);

  // Minimum suffixe des points de contrôle (jusqu'au dernier chèque ; ensuite monotone)
  const suffixMin = new Array<number>(days.length);
  const suffixAt = new Array<string>(days.length);
  for (let i = days.length - 1; i >= 0; i--) {
    if (i === days.length - 1 || days[i].checkpoint <= suffixMin[i + 1]) {
      suffixMin[i] = days[i].checkpoint;
      suffixAt[i] = days[i].date;
    } else {
      suffixMin[i] = suffixMin[i + 1];
      suffixAt[i] = suffixAt[i + 1];
    }
  }

  const offset = daysBetween(today, start);
  for (let i = offset; i < days.length; i++) {
    if (suffixMin[i] - amount >= buffer - 1e-6) {
      const date = days[i].date;
      return {
        date,
        margin: suffixMin[i] - amount,
        tightest: suffixAt[i],
        manual: manualDate(input, amount),
        squeezed: date < last,
      };
    }
    if (dailyRate <= 0 && days[i].date > last) break;
  }
  return null;
}

export interface ChequeRisk {
  id: string;
  checkpoint: number; // solde après le débit de ce chèque
  short: number; // montant manquant (> 0 = découvert ou sous la marge)
}

/** Analyse du calendrier : solde après le débit de chaque chèque */
export function analyseCheques(input: PlanInput, buffer: number): Map<string, ChequeRisk> {
  const last = lastChequeDate(input.cheques, input.today);
  const days = simulate(input, last);
  const byDate = new Map(days.map((d) => [d.date, d]));
  // Solde juste après les débits du jour (plusieurs chèques le même jour partagent ce solde)
  const out = new Map<string, ChequeRisk>();
  for (const c of input.cheques) {
    const d = byDate.get(effDate(c, input.today));
    const checkpoint = d ? d.checkpoint : 0;
    out.set(c.id, { id: c.id, checkpoint, short: Math.max(0, buffer - checkpoint) });
  }
  return out;
}

/** Pour un chèque à risque : première date sûre en le retirant du calendrier */
export function rescheduleDate(input: PlanInput, cheque: PlannedCheque, buffer: number): string | null {
  const others = input.cheques.filter((c) => c.id !== cheque.id);
  return suggestDate({ ...input, cheques: others }, cheque.amount, buffer, effDate(cheque, input.today))?.date ?? null;
}
