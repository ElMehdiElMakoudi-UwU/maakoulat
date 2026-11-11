// =====================================================================
// Dossier comptable mensuel — fonctions pures.
//  • rapprochement débit bancaire → fournisseur (via chèques saisis)
//  • équilibrage TVA : choisir quelles factures de vente sont à 20 % / 0 %
//    pour que TVA collectée ≈ TVA déductible (juste au-dessus)
//  • remplissage d'une facture à partir des ventes réelles du mois
// =====================================================================

import type { PoolLine } from "@/lib/ventilation";

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
export function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

/** HT / TVA d'un montant TTC. */
export function splitTTC(ttc: number, rate: number) {
  const ht = rate > 0 ? ttc / (1 + rate / 100) : ttc;
  return { ht: round2(ht), vat: round2(ttc - ht) };
}

export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------
// Relevé → registres
// ---------------------------------------------------------------------

/** N° de chèque dans un libellé ("PAIEMENT CHEQUE N 0010938" → "10938"). */
export function chequeNumberFromLabel(label: string): string | null {
  const m = label.toUpperCase().match(/CHEQUE\s*N[°O]?\s*0*(\d{3,})/);
  return m ? m[1] : null;
}
export function normCheque(n: string | null | undefined): string {
  return (n ?? "").replace(/\D/g, "").replace(/^0+/, "");
}

/** Débit qui ressemble à un paiement fournisseur (chèque / effet). */
export function isSupplierDebit(label: string, kind: string): boolean {
  return kind === "paiement_frs" || /PAIEMENT\s+CHEQUE|EFFET|LCN/i.test(label);
}

/** Mode de règlement d'un crédit (vente) d'après son libellé. */
export function saleModeFromLabel(label: string): string {
  const L = label.toUpperCase();
  if (/VERSEMENT\s+ESPECE/.test(L)) return "espece";
  if (/\bVIR/.test(L)) return "virement";
  if (/CHEQUE/.test(L)) return "cheque";
  return "autre";
}

// ---------------------------------------------------------------------
// Équilibrage TVA
// ---------------------------------------------------------------------

export interface BalanceInput {
  id: string;
  ttc: number;
  rate: number; // taux actuel
  locked: boolean; // taux fixé à la main → ne pas toucher
}

export interface BalanceResult {
  rates: Record<string, number>; // id → 20 | 0 (factures non verrouillées uniquement)
  collected: number; // TVA collectée obtenue (toutes factures)
  feasible: boolean; // contraintes de plafond respectées
}

/**
 * Choisit le sous-ensemble de factures (non verrouillées) à passer à `highRate`
 * (les autres à 0 %) pour que la TVA collectée soit ≥ déductible, au plus près.
 * Contraintes optionnelles : capacité TTC des ventes réelles à 0 % et à highRate
 * (on ne peut pas facturer à 0 % plus que le poisson réellement vendu).
 * Somme de sous-ensemble exacte (programmation dynamique, au dirham près).
 */
export function balanceRates(
  invoices: BalanceInput[],
  deductible: number,
  opts: { highRate?: number; capZero?: number; capHigh?: number } = {}
): BalanceResult {
  const high = opts.highRate ?? 20;
  const k = high / (100 + high); // part de TVA dans un TTC
  const locked = invoices.filter((i) => i.locked);
  const free = invoices.filter((i) => !i.locked && i.ttc > 0);

  const lockedVat = locked.reduce((s, i) => s + (i.rate > 0 ? (i.ttc * i.rate) / (100 + i.rate) : 0), 0);
  const lockedZero = locked.filter((i) => i.rate === 0).reduce((s, i) => s + i.ttc, 0);
  const lockedHigh = locked.filter((i) => i.rate === high).reduce((s, i) => s + i.ttc, 0);

  const amounts = free.map((i) => Math.max(0, Math.round(i.ttc)));
  const total = amounts.reduce((s, a) => s + a, 0);

  // bornes sur S = Σ TTC des factures libres passées à highRate
  let lo = Math.ceil(Math.max(0, deductible - lockedVat) / k - 1e-6);
  if (opts.capZero != null) lo = Math.max(lo, Math.ceil(total - Math.max(0, opts.capZero - lockedZero)));
  let hi = total;
  if (opts.capHigh != null) hi = Math.min(hi, Math.floor(Math.max(0, opts.capHigh - lockedHigh)));

  // DP : parent[s] = indice de l'élément ajouté pour atteindre s (-1 = non atteint)
  const parent = new Int32Array(total + 1).fill(-1);
  const reach = new Uint8Array(total + 1);
  reach[0] = 1;
  for (let idx = 0; idx < amounts.length; idx++) {
    const a = amounts[idx];
    if (a === 0) continue;
    for (let s = total; s >= a; s--) {
      if (!reach[s] && reach[s - a]) {
        reach[s] = 1;
        parent[s] = idx;
      }
    }
  }

  let best = -1;
  let feasible = true;
  for (let s = Math.max(0, lo); s <= Math.min(hi, total); s++) if (reach[s]) { best = s; break; }
  if (best < 0) {
    feasible = false;
    // à défaut : le plus proche de la borne basse (au-dessus si possible)
    for (let s = Math.max(0, lo); s <= total; s++) if (reach[s]) { best = s; break; }
    if (best < 0) for (let s = Math.min(total, lo); s >= 0; s--) if (reach[s]) { best = s; break; }
  }

  const chosen = new Set<number>();
  for (let s = Math.max(0, best); s > 0; ) {
    const idx = parent[s];
    if (idx < 0) break;
    chosen.add(idx);
    s -= amounts[idx];
  }

  const rates: Record<string, number> = {};
  free.forEach((inv, idx) => (rates[inv.id] = chosen.has(idx) ? high : 0));
  const collected = round2(
    lockedVat + free.reduce((s, inv, idx) => s + (chosen.has(idx) ? inv.ttc * k : 0), 0)
  );
  return { rates, collected, feasible };
}

// ---------------------------------------------------------------------
// Remplissage d'une facture
// ---------------------------------------------------------------------

export interface FillLine {
  product_id: string;
  designation: string;
  unit: string | null;
  quantity: number;
  unit_price: number; // PU HT (3 décimales max)
  vat_rate: number;
}

/**
 * Remplit une facture de `target` TTC au taux `rate` avec les produits du pool
 * de ce taux (unités entières, `avail` décrémenté). Glouton 2 passes (gros lots
 * puis appoint), puis ajustement du PU d'une ligne pour tomber pile sur le TTC
 * (si l'ajustement reste < 3 % du PU). Renvoie aussi le TTC atteint.
 */
export function fillInvoice(
  pool: PoolLine[],
  avail: Map<string, number>,
  rate: number,
  target: number
): { lines: FillLine[]; ttc: number } {
  const cands = pool.filter((l) => l.vat === rate && l.pu > 0);
  const m = 1 + rate / 100;
  const byId = new Map<string, FillLine>();
  let remain = target;

  const passes = [
    [...cands].sort((a, b) => b.pu * (avail.get(b.product_id) ?? 0) - a.pu * (avail.get(a.product_id) ?? 0)),
    [...cands].sort((a, b) => a.pu - b.pu),
  ];
  for (const order of passes) {
    for (const l of order) {
      const p = l.pu * m;
      const a = Math.floor(avail.get(l.product_id) ?? 0);
      if (a <= 0) continue;
      // 1re passe : pas plus de ~45 % de l'objectif par produit → factures variées
      const capShare = order === passes[0] ? Math.floor((target * 0.45) / p) : Infinity;
      const take = Math.min(Math.floor((remain + 1e-6) / p), a, Math.max(1, capShare));
      if (take <= 0) continue;
      const ex = byId.get(l.product_id);
      if (ex) ex.quantity += take;
      else
        byId.set(l.product_id, {
          product_id: l.product_id,
          designation: l.name,
          unit: l.unit,
          quantity: take,
          unit_price: round3(l.pu),
          vat_rate: rate,
        });
      avail.set(l.product_id, (avail.get(l.product_id) ?? 0) - take);
      remain -= take * p;
    }
  }

  const lines = [...byId.values()];
  // ajustement exact du PU sur la ligne au plus gros montant
  const ht = lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);
  const diffHT = target / m - ht;
  if (lines.length && Math.abs(diffHT) > 0.001) {
    // la ligne dont l'ajustement laisse le plus petit résidu (et reste < 3 % du PU)
    let bestLine: FillLine | null = null;
    let bestPu = 0;
    let bestRes = Infinity;
    for (const l of lines) {
      const newPu = round3(l.unit_price + diffHT / l.quantity);
      if (newPu <= 0 || Math.abs(newPu - l.unit_price) > l.unit_price * 0.03) continue;
      const res = Math.abs(diffHT - (newPu - l.unit_price) * l.quantity);
      if (res < bestRes - 1e-9) { bestRes = res; bestLine = l; bestPu = newPu; }
    }
    if (bestLine) bestLine.unit_price = bestPu;
  }
  return { lines, ttc: linesTTC(lines) };
}

export function linesTTC(lines: { quantity: number; unit_price: number; vat_rate: number }[]): number {
  const ht = lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);
  const tva = lines.reduce((s, l) => s + l.quantity * l.unit_price * (l.vat_rate / 100), 0);
  return round2(ht + tva);
}
