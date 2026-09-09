// =====================================================================
// Parsing d'un relevé de compte Attijariwafa bank (PDF) → mouvements.
// Fonctions pures, sans dépendance : l'extraction PDF est faite en amont
// (route API avec unpdf/pdfjs) qui fournit les lignes sous forme de
// tokens positionnés {x, s}. `rowsFromLayoutText` permet aussi de partir
// d'un texte type `pdftotext -layout` (tests / secours).
// =====================================================================

export interface Tok {
  x: number;
  s: string;
}
export interface Row {
  tokens: Tok[];
}
export interface Page {
  rows: Row[];
}

export type TxDirection = "debit" | "credit";
export type TxKind = "encaissement" | "paiement_frs" | "apport" | "charge" | "autre";

export interface ParsedTx {
  op_date: string; // YYYY-MM-DD
  value_date: string | null;
  label: string;
  op_ref: string | null;
  amount: number; // signé : négatif = débit
  direction: TxDirection;
  kind: TxKind;
  charge_cat: string | null;
  fingerprint: string;
}

export interface ParsedStatement {
  period_start: string | null;
  period_end: string | null;
  opening_balance: number;
  closing_balance: number;
  total_debit: number;
  total_credit: number;
  transactions: ParsedTx[];
  // contrôles
  sum_debit: number;
  sum_credit: number;
  balances_ok: boolean; // opening + credits - debits == closing
  totals_ok: boolean; // Σ lignes == totaux déclarés
  warnings: string[];
}

// ---------- helpers ----------

const MONEY_RE = /^\d{1,3}(?:[   ]\d{3})*,\d{2}$/;

function parseMoney(s: string): number {
  return parseFloat(s.replace(/[   ]/g, "").replace(",", "."));
}

function isInt(s: string): boolean {
  return /^\d{1,3}$/.test(s);
}
function isMoneyEnd(s: string): boolean {
  return /^\d{1,3},\d{2}$/.test(s);
}

/** Regroupe les tokens numériques consécutifs formant un montant (ex "275" "527,76"). */
function moneyGroups(tokens: Tok[]): { value: number; x: number }[] {
  const out: { value: number; x: number }[] = [];
  let pending: Tok[] = [];
  const flush = (endTok?: Tok) => {
    if (endTok) pending.push(endTok);
    if (pending.length) {
      const joined = pending.map((t) => t.s).join(" ");
      if (MONEY_RE.test(joined) || /^\d+,\d{2}$/.test(joined.replace(/\s/g, ""))) {
        out.push({ value: parseMoney(joined), x: pending[0].x });
      }
    }
    pending = [];
  };
  for (const t of tokens) {
    if (isMoneyEnd(t.s)) flush(t);
    else if (isInt(t.s)) pending.push(t);
    else if (MONEY_RE.test(t.s)) {
      flush();
      out.push({ value: parseMoney(t.s), x: t.x });
    } else pending = [];
  }
  return out;
}

function toISO(d: number, m: number, y: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Sépare un token collé à la date valeur (artefact d'extraction : "MAKO05" "08" "2026").
 * Renvoie une nouvelle liste de tokens, x approximé pour la partie détachée.
 */
function splitGluedDates(tokens: Tok[]): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const m = t.s.match(/^(\D.*?)(\d{2})$/);
    if (
      m &&
      i + 2 < tokens.length &&
      /^\d{2}$/.test(tokens[i + 1].s) &&
      /^\d{4}$/.test(tokens[i + 2].s)
    ) {
      out.push({ x: t.x, s: m[1] });
      out.push({ x: t.x + Math.max(1, t.s.length - 2), s: m[2] });
    } else {
      out.push(t);
    }
  }
  return out;
}

/** Cherche 3 tokens consécutifs jj mm aaaa ; renvoie [index, iso] du dernier trouvé. */
function findSpacedDate(tokens: string[]): { idx: number; iso: string } | null {
  let found: { idx: number; iso: string } | null = null;
  for (let i = 0; i + 2 < tokens.length; i++) {
    if (/^\d{2}$/.test(tokens[i]) && /^\d{2}$/.test(tokens[i + 1]) && /^\d{4}$/.test(tokens[i + 2])) {
      const d = +tokens[i], m = +tokens[i + 1], y = +tokens[i + 2];
      if (d >= 1 && d <= 31 && m >= 1 && m <= 12) found = { idx: i, iso: toISO(d, m, y) };
    }
  }
  return found;
}

const CREDIT_HINT =
  /VERSEMENT\s+ESPECE|VIR.*RE[CÇ]U|VIREMENT.*RE[CÇ]U|RE[CÇ]U\s+DE|\bREMISE\b|ENCAISSEMENT/i;
const DEBIT_HINT =
  /PAIEMENT|PRELEVEMENT|CHEQUE|OPERATION\s+AU\s+DEBIT|\bDGI\b|ASSURANCE|\bSMS\b|FRAIS|TIMBRE|ECHEANCE|IMPAYE|COMMISSION|AGIOS|COTISATION|CNSS|EN\s+FAV|VIR.*EMIS|RETRAIT/i;

/** Sens du mouvement : libellé d'abord (très régulier chez AWB), position ensuite. */
function guessDirection(label: string, amtX: number, threshold: number | null): TxDirection {
  if (CREDIT_HINT.test(label)) return "credit";
  if (DEBIT_HINT.test(label)) return "debit";
  if (threshold != null) return amtX < threshold ? "debit" : "credit";
  return "debit";
}

function classifyKind(label: string, dir: TxDirection): { kind: TxKind; charge_cat: string | null } {
  const L = label.toUpperCase();
  if (dir === "credit") {
    if (/VERSEMENT\s+ESPECE/.test(L)) return { kind: "encaissement", charge_cat: null };
    if (/VIR|VIREMENT/.test(L)) return { kind: "apport", charge_cat: null };
    return { kind: "encaissement", charge_cat: null };
  }
  if (/CHEQUE/.test(L)) return { kind: "paiement_frs", charge_cat: null };
  if (/\bDGI\b|IMPOT|\bTVA\b|\bI\.?R\b|\bI\.?S\b|PATENTE|TAXE/.test(L)) return { kind: "charge", charge_cat: "impots" };
  if (/CNSS|AMO/.test(L)) return { kind: "charge", charge_cat: "cnss" };
  if (/WAFABAIL|LEASING|WAFASALAF|SALAF/.test(L)) return { kind: "charge", charge_cat: "leasing" };
  if (/ASSURANCE|SECURICARTE|MAMDA|WAFA\s?ASSUR/.test(L)) return { kind: "charge", charge_cat: "assurance" };
  if (/FRAIS|SMS|TIMBRE|COMMISSION|AGIOS|TENUE\s+DE\s+COMPTE|COTISATION\s+CARTE/.test(L))
    return { kind: "charge", charge_cat: "frais_bancaires" };
  if (/ECHEANCE\s+CREDIT|CREDIT\s+CRINV|INTERETS|IMPAYE/.test(L)) return { kind: "charge", charge_cat: "credit" };
  return { kind: "charge", charge_cat: "autre" };
}

function balSign(tokensAfter: string[]): 1 | -1 {
  return tokensAfter.some((t) => /DEBITEUR/i.test(t)) ? -1 : 1;
}

// ---------- parsing principal ----------

export function parseStatement(pages: Page[], filename?: string): ParsedStatement {
  const warnings: string[] = [];
  const allRows: Row[] = pages.flatMap((p) => p.rows);

  // 1) Repérage des lignes de synthèse + anchrage des colonnes débit/crédit
  let opening = 0, closing = 0, totalDebit = 0, totalCredit = 0;
  let debitColX: number | null = null, creditColX: number | null = null;
  let periodEnd: string | null = null;

  for (const row of allRows) {
    const words = row.tokens.map((t) => t.s);
    const text = words.join(" ");
    const groups = moneyGroups(row.tokens);

    if (/SOLDE\s+DEPART/i.test(text) && groups.length) {
      opening = groups[groups.length - 1].value * balSign(words);
    } else if (/SOLDE\s+FINAL/i.test(text) && groups.length) {
      const sd = findSpacedDate(words);
      if (sd) periodEnd = sd.iso;
      closing = groups[groups.length - 1].value * balSign(words);
    } else if (/TOTAL\s+MOUVEMENTS/i.test(text) && groups.length >= 2) {
      totalDebit = groups[0].value;
      totalCredit = groups[1].value;
      debitColX = groups[0].x;
      creditColX = groups[1].x;
    }
  }

  const threshold =
    debitColX != null && creditColX != null ? (debitColX + creditColX) / 2 : null;

  // 2) Transactions
  const transactions: ParsedTx[] = [];
  for (const rawRow of allRows) {
    const row: Row = { tokens: splitGluedDates(rawRow.tokens) };
    const words = row.tokens.map((t) => t.s);
    const text = words.join(" ");
    if (/SOLDE|TOTAL\s+MOUVEMENTS|MOUVEMENTS|Attijariwafa|capital|R\.?C\.?\s|PAGE\s|DIRHAM/i.test(text))
      continue;
    // opcode + jj mm en tête
    if (!(words.length >= 5 && /^[0-9A-Z]{4,8}$/.test(words[0]) && /^\d{2}$/.test(words[1]) && /^\d{2}$/.test(words[2])))
      continue;

    const date = findSpacedDate(words);
    if (!date) continue;

    const opRef = words[0];
    const opDay = +words[1], opMon = +words[2];
    const year = +date.iso.slice(0, 4);
    const opISO = toISO(opDay, opMon, year);

    const labelTokens = words.slice(3, date.idx);
    const label = labelTokens.join(" ").replace(/\s+/g, " ").trim();
    if (!label) continue;

    // montant : groupes après la date valeur
    const afterToks = row.tokens.filter((_, i) => i >= date.idx + 3);
    const groups = moneyGroups(afterToks);
    if (!groups.length) continue;
    const amt = groups[0];

    const direction = guessDirection(label, amt.x, threshold);
    const { kind, charge_cat } = classifyKind(label, direction);
    const signed = direction === "debit" ? -amt.value : amt.value;

    transactions.push({
      op_date: opISO,
      value_date: date.iso,
      label,
      op_ref: opRef,
      amount: signed,
      direction,
      kind,
      charge_cat,
      fingerprint: `${date.iso}|${Math.round(signed * 100)}|${label}`,
    });
  }

  // 3) Contrôles
  const sumDebit = round2(transactions.filter((t) => t.direction === "debit").reduce((s, t) => s - t.amount, 0));
  const sumCredit = round2(transactions.filter((t) => t.direction === "credit").reduce((s, t) => s + t.amount, 0));

  const balancesOk = Math.abs(round2(opening + sumCredit - sumDebit) - round2(closing)) < 0.02;
  const totalsOk =
    (!totalDebit || Math.abs(sumDebit - totalDebit) < 0.02) &&
    (!totalCredit || Math.abs(sumCredit - totalCredit) < 0.02);

  if (!transactions.length) warnings.push("Aucun mouvement détecté dans le PDF.");
  if (totalDebit && !totalsOk)
    warnings.push(
      `Écart avec les totaux du relevé : débit ${sumDebit.toFixed(2)} / ${totalDebit.toFixed(2)}, crédit ${sumCredit.toFixed(2)} / ${totalCredit.toFixed(2)}.`
    );
  if (!balancesOk && (opening || closing))
    warnings.push(
      `Le solde ne se recompose pas : ${opening.toFixed(2)} + ${sumCredit.toFixed(2)} − ${sumDebit.toFixed(2)} ≠ ${closing.toFixed(2)}.`
    );
  if (threshold == null)
    warnings.push("Colonnes débit/crédit non repérées : sens déduit du libellé, à vérifier.");

  let periodStart: string | null = null;
  if (periodEnd) periodStart = periodEnd.slice(0, 8) + "01";
  else if (filename) {
    const m = filename.match(/(\d{2})[_-](\d{2})[_-](\d{4})/);
    if (m) periodStart = `${m[3]}-${m[2]}-${m[1]}`;
  }

  return {
    period_start: periodStart,
    period_end: periodEnd,
    opening_balance: round2(opening),
    closing_balance: round2(closing),
    total_debit: round2(totalDebit || sumDebit),
    total_credit: round2(totalCredit || sumCredit),
    transactions,
    sum_debit: sumDebit,
    sum_credit: sumCredit,
    balances_ok: balancesOk,
    totals_ok: totalsOk,
    warnings,
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Construit des `Page[]` à partir d'un texte type `pdftotext -layout`
 * (un pseudo-x = index du caractère). Utile pour les tests et comme
 * secours si l'extraction positionnée échoue.
 */
export function rowsFromLayoutText(text: string): Page[] {
  const pages = text.split(/\f/);
  return pages.map((pg) => ({
    rows: pg
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .map((line) => {
        const tokens: Tok[] = [];
        const re = /\S+/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(line))) tokens.push({ x: m.index, s: m[0] });
        return { tokens };
      }),
  }));
}
