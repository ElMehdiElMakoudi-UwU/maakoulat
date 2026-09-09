// =====================================================================
// Génération des factures de vente à partir du "pool" mensuel.
// Fonctions pures. Contrainte : Σ des quantités facturées par produit
// (toutes factures confondues) ≤ quantité réellement vendue ce mois.
// Le "comptant" absorbe l'écart d'arrondi (unités entières uniquement).
// =====================================================================

export interface PoolLine {
  product_id: string;
  name: string;
  unit: string | null;
  vat: number; // %
  pu: number; // PU HT catalogue (moyen pondéré)
  qty: number; // quantité disponible ce mois (plafond)
}

export interface TargetInput {
  client_id: string;
  target_ttc: number;
  discount_rate: number; // %
}

export interface GenLine {
  product_id: string;
  designation: string;
  unit: string | null;
  quantity: number;
  unit_price: number; // PU HT après remise
  vat_rate: number;
}

export interface GenInvoice {
  client_id: string;
  target_ttc: number;
  discount_rate: number;
  lines: GenLine[];
  ttc: number; // TTC réellement atteint
}

export interface GenResult {
  invoices: GenInvoice[];
  comptant: { lines: GenLine[]; ttc: number };
}

function lineTTC(l: GenLine): number {
  return l.quantity * l.unit_price * (1 + l.vat_rate / 100);
}
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Remplit une facture pour un client : glouton unités entières, 2 passes (gros lots puis appoint). */
function fillClient(
  avail: Map<string, number>,
  pool: PoolLine[],
  target: number,
  disc: number
): { lines: GenLine[]; ttc: number } {
  const byId = new Map<string, GenLine>();
  let remain = target;

  const puTTCeff = (l: PoolLine) => l.pu * (1 - disc / 100) * (1 + l.vat / 100);

  const passes = [
    [...pool].sort((a, b) => puTTCeff(b) * (avail.get(b.product_id) ?? 0) - puTTCeff(a) * (avail.get(a.product_id) ?? 0)),
    [...pool].sort((a, b) => puTTCeff(a) - puTTCeff(b)),
  ];

  for (const order of passes) {
    for (const l of order) {
      const p = puTTCeff(l);
      if (p <= 0) continue;
      const a = avail.get(l.product_id) ?? 0;
      if (a <= 0) continue;
      const byTarget = Math.floor((remain + 1e-6) / p);
      const take = Math.min(byTarget, a);
      if (take <= 0) continue;

      const existing = byId.get(l.product_id);
      if (existing) existing.quantity += take;
      else
        byId.set(l.product_id, {
          product_id: l.product_id,
          designation: l.name,
          unit: l.unit,
          quantity: take,
          unit_price: round2(l.pu * (1 - disc / 100)),
          vat_rate: l.vat,
        });
      avail.set(l.product_id, a - take);
      remain -= take * p;
    }
  }

  const lines = [...byId.values()];
  return { lines, ttc: round2(lines.reduce((s, l) => s + lineTTC(l), 0)) };
}

export function generateInvoices(pool: PoolLine[], targets: TargetInput[]): GenResult {
  const avail = new Map(pool.map((l) => [l.product_id, l.qty] as const));

  // clients traités du plus gros objectif au plus petit
  const ordered = [...targets].filter((t) => t.target_ttc > 0).sort((a, b) => b.target_ttc - a.target_ttc);

  const invoices: GenInvoice[] = ordered.map((tg) => {
    const { lines, ttc } = fillClient(avail, pool, tg.target_ttc, tg.discount_rate);
    return {
      client_id: tg.client_id,
      target_ttc: tg.target_ttc,
      discount_rate: tg.discount_rate,
      lines,
      ttc,
    };
  });

  // comptant = tout ce qui reste dans le pool (PU plein, sans remise)
  const comptantLines: GenLine[] = pool
    .map((l) => {
      const left = avail.get(l.product_id) ?? 0;
      return left > 0
        ? {
            product_id: l.product_id,
            designation: l.name,
            unit: l.unit,
            quantity: left,
            unit_price: round2(l.pu),
            vat_rate: l.vat,
          }
        : null;
    })
    .filter((x): x is GenLine => x !== null);

  return {
    invoices,
    comptant: {
      lines: comptantLines,
      ttc: round2(comptantLines.reduce((s, l) => s + lineTTC(l), 0)),
    },
  };
}

/** Totaux HT / TVA / TTC d'une liste de lignes (TVA par ligne). */
export function invoiceTotals(lines: { quantity: number; unit_price: number; vat_rate: number }[]) {
  let ht = 0;
  let tva = 0;
  for (const l of lines) {
    const lineHT = l.quantity * l.unit_price;
    ht += lineHT;
    tva += lineHT * (l.vat_rate / 100);
  }
  return { ht: round2(ht), tva: round2(tva), ttc: round2(ht + tva) };
}
