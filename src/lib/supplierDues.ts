import type { Supplier, SupplierInvoice, SupplierPayment } from "./types";

export type DueStatus = "paid" | "overdue" | "due_soon" | "upcoming";

export interface OpenInvoice {
  invoice: SupplierInvoice;
  supplier_id: string;
  due_date: string; // YYYY-MM-DD (échéance effective)
  remaining: number; // reste à payer sur cette facture après allocation FIFO
  status: DueStatus;
  days: number; // jours jusqu'à l'échéance (négatif = en retard)
}

/** Nombre de jours avant une échéance considérée « bientôt due » */
export const DUE_SOON_DAYS = 7;

/** Ajoute n jours à une date YYYY-MM-DD (calcul en UTC pour éviter les décalages d'heure d'été) */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** Écart en jours entre deux dates YYYY-MM-DD (to − from) */
export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** Échéance effective : due_date saisie, sinon date facture + délai du fournisseur */
export function effectiveDueDate(inv: SupplierInvoice, termsDays: number): string {
  return inv.due_date ?? addDays(inv.inv_date, termsDays || 0);
}

function statusFor(remaining: number, days: number): DueStatus {
  if (remaining <= 0.005) return "paid";
  if (days < 0) return "overdue";
  if (days <= DUE_SOON_DAYS) return "due_soon";
  return "upcoming";
}

/**
 * Pour chaque facture, calcule le reste à payer en imputant les paiements
 * du fournisseur sur les factures les plus anciennes d'abord (FIFO).
 */
export function allocateInvoices(
  suppliers: Supplier[],
  invoices: SupplierInvoice[],
  payments: SupplierPayment[],
  todayStr: string
): OpenInvoice[] {
  const terms = new Map(suppliers.map((s) => [s.id, s.payment_terms_days ?? 0]));
  const paidBySupplier = new Map<string, number>();
  for (const p of payments) {
    paidBySupplier.set(p.supplier_id, (paidBySupplier.get(p.supplier_id) ?? 0) + Number(p.amount));
  }

  const sorted = [...invoices].sort((a, b) =>
    a.inv_date !== b.inv_date
      ? a.inv_date < b.inv_date ? -1 : 1
      : (a.created_at ?? "") < (b.created_at ?? "") ? -1 : 1
  );

  const out: OpenInvoice[] = [];
  for (const inv of sorted) {
    const amount = Number(inv.amount);
    const pool = paidBySupplier.get(inv.supplier_id) ?? 0;
    const applied = Math.min(Math.max(pool, 0), amount);
    paidBySupplier.set(inv.supplier_id, pool - applied);
    const remaining = amount - applied;
    const due_date = effectiveDueDate(inv, terms.get(inv.supplier_id) ?? 0);
    const days = daysBetween(todayStr, due_date);
    out.push({ invoice: inv, supplier_id: inv.supplier_id, due_date, remaining, status: statusFor(remaining, days), days });
  }
  return out;
}

/** Totaux en retard / à échéance proche, éventuellement filtrés par fournisseur */
export function dueSummary(rows: OpenInvoice[]) {
  let overdue = 0;
  let dueSoon = 0;
  let overdueCount = 0;
  let dueSoonCount = 0;
  for (const r of rows) {
    if (r.status === "overdue") { overdue += r.remaining; overdueCount++; }
    else if (r.status === "due_soon") { dueSoon += r.remaining; dueSoonCount++; }
  }
  return { overdue, dueSoon, overdueCount, dueSoonCount };
}
