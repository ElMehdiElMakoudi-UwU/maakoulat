import type { BankLoan } from "./types";

// Crédits bancaires : échéancier à mensualité fixe.
// Les échéances datées d'avant aujourd'hui sont considérées comme prélevées.

export interface LoanEcheance {
  loanId: string;
  n: number; // 1 … duration_months
  date: string; // YYYY-MM-DD
  amount: number; // mensualité
  interest: number;
  capital: number;
  remainingCapital: number; // capital restant dû après cette échéance
}

/**
 * Date de la n-ième échéance (0 = première) : mois de `date` + n, au jour `day`
 * (par défaut celui de `date`), ramené à la fin du mois si besoin (31 → 30/28)
 */
export function addMonthsClamped(date: string, n: number, day?: number | null): string {
  const [y, m, dd] = date.split("-").map(Number);
  const d = day || dd;
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Mensualité théorique d'un prêt amortissable (taux annuel %) */
export function annuityPayment(principal: number, annualRate: number, months: number): number {
  if (months <= 0) return 0;
  const r = annualRate / 100 / 12;
  if (r <= 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Échéancier complet d'un crédit */
export function loanSchedule(loan: BankLoan): LoanEcheance[] {
  const r = Number(loan.interest_rate) / 100 / 12;
  const payment = Number(loan.monthly_payment);
  let balance = Number(loan.principal);
  const out: LoanEcheance[] = [];
  for (let i = 0; i < loan.duration_months; i++) {
    const interest = r > 0 ? round2(balance * r) : 0;
    const last = i === loan.duration_months - 1;
    const capital = last ? balance : Math.min(balance, Math.max(0, payment - interest));
    balance = Math.max(0, round2(balance - capital));
    out.push({
      loanId: loan.id,
      n: i + 1,
      date: addMonthsClamped(loan.first_due_date, i, loan.payment_day),
      amount: payment,
      interest,
      capital: round2(capital),
      remainingCapital: balance,
    });
  }
  return out;
}

export interface LoanSummary {
  paidCount: number;
  remainingCount: number;
  remainingCapital: number; // capital restant dû aujourd'hui
  remainingToPay: number; // Σ mensualités restantes
  next: LoanEcheance | null;
  end: string; // date de la dernière échéance
}

export function loanSummary(loan: BankLoan, todayStr: string): LoanSummary {
  const sched = loanSchedule(loan);
  const upcoming = sched.filter((e) => e.date >= todayStr);
  const paid = sched.length - upcoming.length;
  return {
    paidCount: paid,
    remainingCount: upcoming.length,
    remainingCapital: paid ? sched[paid - 1].remainingCapital : Number(loan.principal),
    remainingToPay: upcoming.reduce((a, e) => a + e.amount, 0),
    next: upcoming[0] ?? null,
    end: sched[sched.length - 1]?.date ?? loan.first_due_date,
  };
}

/** Échéances à venir (≥ aujourd'hui) des crédits actifs, triées par date */
export function upcomingEcheances(loans: BankLoan[], todayStr: string): LoanEcheance[] {
  return loans
    .filter((l) => l.status === "active")
    .flatMap((l) => loanSchedule(l).filter((e) => e.date >= todayStr))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
