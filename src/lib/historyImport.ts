import { splitCsvLine } from "./productImport";
import { excelSerialToDate, type Cell, type SheetData } from "./xlsx";
import type { Product, SellerKind } from "./types";

// Import de l'historique de ventes (Excel ou CSV). Deux formats acceptés,
// éventuellement dans le même classeur (une feuille chacun) :
//
// 1) Grille mensuelle — feuille « Mensuel » :
//      produit | type_client | 2024-01 | 2024-02 | …      (une ligne par produit et type)
// 2) Lignes — feuille « Ventes » :
//      date_debut | date_fin | produit | type_client | quantite
//    (date_fin vide = vente d'un seul jour ; une période = total vendu sur la période)
//
// Les autres feuilles (ex : « Produits », « Aide ») sont ignorées.

export interface ParsedHistoryRow {
  label: string; // libellé produit tel que saisi
  kind: SellerKind;
  start: string;
  end: string;
  quantity: number;
}

export interface HistoryParseResult {
  rows: ParsedHistoryRow[];
  errors: { sheet: string; line: number; reason: string }[];
  recognized: boolean; // au moins une feuille au bon format
}

export function normLabel(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const normHeader = (s: Cell) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9]/g, "");

const H_PRODUCT = ["produit", "product", "article", "nom", "name", "designation"];
const H_KIND = ["typeclient", "type", "client", "canal", "sellerkind", "kind"];
const H_START = ["datedebut", "debut", "date", "du", "start"];
const H_END = ["datefin", "fin", "au", "end"];
const H_QTY = ["quantite", "qte", "qty", "quantity"];

export function parseKind(v: Cell): SellerKind | null {
  const s = normHeader(v);
  if (!s || ["retail", "detail", "magasin", "commerce", "boutique", "particulier"].includes(s)) return "retail";
  if (["traiteur", "restaurant", "restaurants", "resto", "horeca", "cafe", "snack"].includes(s)) return "traiteur";
  return null;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function lastDay(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Interprète une date : jour précis ou mois entier. */
export function parseDateCell(v: Cell): { start: string; end: string; month: boolean } | null {
  if (v === null || v === "") return null;
  if (typeof v === "number") {
    if (v < 20000 || v > 80000) return null;
    const d = excelSerialToDate(v);
    return { start: d, end: d, month: false };
  }
  const s = v.trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return dayPeriod(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) return dayPeriod(+m[3], +m[2], +m[1]);
  const month = parseMonthHeader(s);
  if (month) return { ...month, month: true };
  if (/^\d+(\.\d+)?$/.test(s)) return parseDateCell(Number(s));
  return null;
}

function dayPeriod(y: number, mo: number, d: number) {
  if (mo < 1 || mo > 12 || d < 1 || d > lastDay(y, mo) || y < 2000 || y > 2100) return null;
  const date = `${y}-${pad(mo)}-${pad(d)}`;
  return { start: date, end: date, month: false };
}

function monthPeriod(y: number, mo: number) {
  if (mo < 1 || mo > 12 || y < 2000 || y > 2100) return null;
  return { start: `${y}-${pad(mo)}-01`, end: `${y}-${pad(mo)}-${pad(lastDay(y, mo))}` };
}

/** En-tête de colonne de la grille mensuelle (« 2025-03 », « 03/2025 » ou date Excel). */
function parseMonthHeader(v: Cell): { start: string; end: string } | null {
  if (typeof v === "number") {
    if (v < 20000 || v > 80000) return null;
    const [y, m] = excelSerialToDate(v).split("-").map(Number);
    return monthPeriod(y, m);
  }
  const s = String(v ?? "").trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})[-/](\d{1,2})$/))) return monthPeriod(+m[1], +m[2]);
  if ((m = s.match(/^(\d{1,2})[/.-](\d{4})$/))) return monthPeriod(+m[2], +m[1]);
  return null;
}

function parseQty(v: Cell): number | null {
  if (v === null || v === "") return null;
  if (typeof v === "number") return v;
  let t = v.trim().replace(/\s/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(t);
  return Number.isNaN(n) ? null : n;
}

export function parseHistorySheets(sheets: SheetData[]): HistoryParseResult {
  const res: HistoryParseResult = { rows: [], errors: [], recognized: false };
  for (const sheet of sheets) {
    const headerRow = sheet.rows.findIndex((r) => r.some((c) => H_PRODUCT.includes(normHeader(c))));
    if (headerRow < 0) continue;
    const header = sheet.rows[headerRow];
    const norm = header.map(normHeader);
    const find = (aliases: string[]) => norm.findIndex((h) => aliases.includes(h));
    const iProduct = find(H_PRODUCT);
    const iKind = find(H_KIND);
    const iStart = find(H_START);
    const iEnd = find(H_END);
    const iQty = find(H_QTY);
    const monthCols = header
      .map((c, i) => ({ i, period: parseMonthHeader(c) }))
      .filter((x): x is { i: number; period: { start: string; end: string } } => x.period !== null);

    const isLong = iStart >= 0 && iQty >= 0;
    if (!isLong && monthCols.length === 0) continue;
    res.recognized = true;

    for (let r = headerRow + 1; r < sheet.rows.length; r++) {
      // Excel omet les cellules vides de fin de ligne : on complète par null
      const raw = sheet.rows[r] ?? [];
      const row = Array.from({ length: header.length }, (_, i) => raw[i] ?? null);
      const label = String(row[iProduct] ?? "").trim();
      if (!label) continue;
      const line = r + 1;
      const kind = iKind >= 0 ? parseKind(row[iKind]) : "retail";
      if (!kind) {
        res.errors.push({ sheet: sheet.name, line, reason: `type_client « ${row[iKind]} »` });
        continue;
      }
      if (isLong) {
        const q = parseQty(row[iQty]);
        if (q === null || q === 0) continue;
        const a = parseDateCell(row[iStart]);
        if (!a) {
          res.errors.push({ sheet: sheet.name, line, reason: `date « ${row[iStart] ?? ""} »` });
          continue;
        }
        const b = iEnd >= 0 ? parseDateCell(row[iEnd]) : null;
        const end = b ? b.end : a.end;
        if (end < a.start) {
          res.errors.push({ sheet: sheet.name, line, reason: "date_fin < date_debut" });
          continue;
        }
        res.rows.push({ label, kind, start: a.start, end, quantity: q });
      } else {
        for (const mc of monthCols) {
          const q = parseQty(row[mc.i]);
          if (q === null) continue;
          // 0 explicite = mois vendu à zéro (donnée utile) ; cellule vide = inconnu
          res.rows.push({ label, kind, start: mc.period.start, end: mc.period.end, quantity: q });
        }
      }
    }
  }
  return res;
}

export function csvToSheet(text: string, name = "CSV"): SheetData {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  return { name, rows: lines.map((l) => splitCsvLine(l).map((c) => c.trim() || null)) };
}

/** Index de recherche produit : nom arabe ou désignation FR, normalisés. */
export function productMatcher(products: Product[]) {
  const map = new Map<string, string>();
  for (const p of products) {
    map.set(normLabel(p.name), p.id);
    if (p.name_fr) map.set(normLabel(p.name_fr), p.id);
  }
  return (label: string) => map.get(normLabel(label)) ?? null;
}

const fmtMonth = (y: number, m: number) => `${y}-${pad(m)}`;

/** Classeur modèle : grille mensuelle pré-remplie + feuille lignes + liste produits + aide. */
export function buildHistoryTemplate(products: Product[], endMonth: string, months = 24): SheetData[] {
  const [ey, em] = endMonth.split("-").map(Number);
  const cols: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(ey, em - 1 - i, 1));
    cols.push(fmtMonth(d.getUTCFullYear(), d.getUTCMonth() + 1));
  }
  const sorted = [...products].sort((a, b) => (a.category ?? "").localeCompare(b.category ?? "") || a.sort_order - b.sort_order);
  const label = (p: Product) => p.name_fr || p.name;

  const grid: Cell[][] = [["produit", "type_client", "categorie", ...cols]];
  for (const kind of ["retail", "traiteur"] as SellerKind[]) {
    for (const p of sorted) grid.push([label(p), kind, p.category ?? "", ...cols.map(() => null)]);
  }

  const first = sorted[0] ? label(sorted[0]) : "Mozzarella 200 g";
  const lines: Cell[][] = [["date_debut", "date_fin", "produit", "type_client", "quantite"]];

  const help: Cell[][] = [
    ["Comment remplir ce fichier"],
    ["Feuille « Mensuel » : saisissez le total vendu par mois (laissez vide si inconnu, 0 si aucune vente)."],
    ["Feuille « Ventes » : une ligne par vente ou par période. date_fin vide = un seul jour. Dates au format AAAA-MM-JJ."],
    ["type_client : retail (magasin / particulier) ou traiteur (restaurants, snacks, cafés)."],
    ["Les noms de produits doivent correspondre au catalogue (voir feuille « Produits ») ; sinon l'app vous proposera d'associer."],
    ["Vous pouvez remplir une seule des deux feuilles. Réimporter une même période remplace les quantités."],
    ["Ne saisissez pas le même mois dans les deux feuilles (les quantités s'additionneraient)."],
    [""],
    ["Exemples pour la feuille « Ventes » :"],
    [`2025-03-01 | 2025-03-31 | ${first} | traiteur | 1250   → total vendu aux restaurants en mars 2025`],
    [`2025-03-15 |            | ${first} | retail   | 40     → vente du 15 mars 2025`],
  ];

  return [
    { name: "Mensuel", rows: grid, colWidths: [42, 12, 14, ...cols.map(() => 10)] },
    { name: "Ventes", rows: lines, colWidths: [12, 12, 42, 12, 10] },
    {
      name: "Produits",
      rows: [["designation_fr", "nom", "categorie"], ...sorted.map((p) => [p.name_fr ?? "", p.name, p.category ?? ""])],
      colWidths: [42, 42, 16],
    },
    { name: "Aide", rows: help, colWidths: [120] },
  ];
}
