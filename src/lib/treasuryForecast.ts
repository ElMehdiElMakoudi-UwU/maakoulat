import { addDays } from "./supplierDues";

// Prévision de trésorerie jour par jour :
//   solde(j) = solde(j−1) + ventes prévues(j) − échéances fournisseurs(j) − charges(j)
// • ventes prévues : moyenne du même jour de semaine sur l'historique récent × facteur
// • échéances fournisseurs : reste à payer de chaque facture, à sa date d'échéance
//   (les factures déjà en retard sont imputées au premier jour)
// • charges : imputées le 1er de chaque mois (comme sur la vue mensuelle)

export interface ForecastOutflow {
  date: string; // YYYY-MM-DD
  amount: number;
  kind: "supplier" | "charges";
  label: string;
}

export interface ForecastDay {
  date: string;
  inflow: number;
  supplierOut: number;
  chargesOut: number;
  balance: number;
}

export interface ForecastWeek {
  start: string;
  end: string;
  inflow: number;
  supplierOut: number;
  chargesOut: number;
  endBalance: number;
}

/** Jour de semaine (0 = dimanche) d'une date YYYY-MM-DD */
export function weekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Moyenne des ventes par jour de semaine sur [from, to] inclus.
 * Les jours sans vente comptent pour 0 (jours de fermeture inclus).
 */
export function weekdayAverages(salesByDate: Record<string, number>, from: string, to: string): number[] {
  const sums = [0, 0, 0, 0, 0, 0, 0];
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const w = weekday(d);
    sums[w] += salesByDate[d] ?? 0;
    counts[w]++;
  }
  return sums.map((s, i) => (counts[i] ? s / counts[i] : 0));
}

/** Prévision sur `horizon` jours, à partir du lendemain de `today` */
export function buildForecast(opts: {
  today: string;
  horizon: number;
  startBalance: number;
  weekdayAvg: number[];
  salesFactor: number;
  outflows: ForecastOutflow[];
}): ForecastDay[] {
  const { today, horizon, startBalance, weekdayAvg, salesFactor, outflows } = opts;
  const first = addDays(today, 1);
  const supplierByDate = new Map<string, number>();
  const chargesByDate = new Map<string, number>();
  for (const o of outflows) {
    const date = o.date < first ? first : o.date; // retard → dû immédiatement
    const map = o.kind === "supplier" ? supplierByDate : chargesByDate;
    map.set(date, (map.get(date) ?? 0) + o.amount);
  }

  const days: ForecastDay[] = [];
  let bal = startBalance;
  for (let i = 0; i < horizon; i++) {
    const date = addDays(first, i);
    const inflow = (weekdayAvg[weekday(date)] ?? 0) * salesFactor;
    const supplierOut = supplierByDate.get(date) ?? 0;
    const chargesOut = chargesByDate.get(date) ?? 0;
    bal += inflow - supplierOut - chargesOut;
    days.push({ date, inflow, supplierOut, chargesOut, balance: bal });
  }
  return days;
}

/** Regroupe la prévision par tranches de 7 jours */
export function groupByWeek(days: ForecastDay[]): ForecastWeek[] {
  const weeks: ForecastWeek[] = [];
  for (let i = 0; i < days.length; i += 7) {
    const chunk = days.slice(i, i + 7);
    weeks.push({
      start: chunk[0].date,
      end: chunk[chunk.length - 1].date,
      inflow: chunk.reduce((s, d) => s + d.inflow, 0),
      supplierOut: chunk.reduce((s, d) => s + d.supplierOut, 0),
      chargesOut: chunk.reduce((s, d) => s + d.chargesOut, 0),
      endBalance: chunk[chunk.length - 1].balance,
    });
  }
  return weeks;
}

/** Point le plus bas de la prévision, et premier jour sous zéro s'il existe */
export function forecastLows(days: ForecastDay[]) {
  let low: ForecastDay | null = null;
  let firstNegative: ForecastDay | null = null;
  for (const d of days) {
    if (!low || d.balance < low.balance) low = d;
    if (!firstNegative && d.balance < 0) firstNegative = d;
  }
  return { low, firstNegative };
}
