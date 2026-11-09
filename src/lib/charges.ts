// Une charge fixe (month = null) s'applique de start_month à end_month inclus
// (null = sans limite). Arrêter une charge fixe renseigne end_month au lieu de
// la supprimer, pour que les mois passés gardent leur total.
export interface ChargePeriod {
  month: string | null;
  active: boolean;
  start_month?: string | null;
  end_month?: string | null;
}

export function chargeAppliesTo(c: ChargePeriod, month: string): boolean {
  if (!c.active) return false;
  if (c.month) return c.month === month;
  if (c.start_month && c.start_month > month) return false;
  if (c.end_month && c.end_month < month) return false;
  return true;
}

export function chargesTotalFor<T extends ChargePeriod & { amount: number }>(rows: T[], month: string): number {
  return rows.filter((c) => chargeAppliesTo(c, month)).reduce((s, c) => s + Number(c.amount), 0);
}

export function prevMonth(month: string): string {
  let [y, m] = month.split("-").map(Number);
  m--;
  if (m < 1) { m = 12; y--; }
  return `${y}-${String(m).padStart(2, "0")}`;
}
