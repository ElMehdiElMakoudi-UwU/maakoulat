// Analyse d'un fichier CSV de catalogue produits.
// Le fichier doit avoir une ligne d'en-tête. Les colonnes reconnues correspondent
// aux champs de la table `products` que l'utilisateur peut remplir :
//   name, name_fr, category, unit, purchase_price, sale_price, vat_rate, supplier
// L'ordre des colonnes n'a pas d'importance ; les colonnes inconnues sont ignorées.

export const TEMPLATE_COLUMNS = [
  "name",
  "name_fr",
  "category",
  "unit",
  "purchase_price",
  "sale_price",
  "traiteur_price",
  "vat_rate",
  "supplier",
] as const;

export type TemplateColumn = (typeof TEMPLATE_COLUMNS)[number];

export interface ParsedProductRow {
  name: string;
  name_fr: string | null;
  category: string | null;
  unit: string | null;
  purchase_price: number;
  sale_price: number;
  traiteur_price: number | null;
  vat_rate: number;
  supplier: string | null;
}

// En-têtes acceptés (FR + clés techniques), normalisés (minuscule, sans accent/espace).
const HEADER_ALIASES: Record<TemplateColumn, string[]> = {
  name: ["name", "nom", "produit", "product", "article"],
  name_fr: ["namefr", "designationfr", "designation", "nomfr", "libellefr", "libelle"],
  category: ["category", "categorie", "famille", "rayon"],
  unit: ["unit", "unite", "conditionnement"],
  purchase_price: ["purchaseprice", "prixdachat", "prixachat", "pa", "pattc", "achat", "pu"],
  sale_price: ["saleprice", "prixdevente", "prixvente", "pv", "pvttc", "vente"],
  traiteur_price: ["traiteurprice", "prixtraiteur", "pvtraiteur", "traiteur"],
  vat_rate: ["vatrate", "tva", "vat", "taxe"],
  supplier: ["supplier", "fournisseur", "frs"],
};

function normHeader(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9]/g, "");
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === "," || c === ";") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

// « 39,17 » -> 39.17 ; « 20,00% » -> 20 ; « 1.234,50 » -> 1234.5
function num(s: string | undefined): number {
  if (!s) return 0;
  let t = s.trim().replace(/%/g, "").replace(/\s/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(t);
  return Number.isNaN(n) ? 0 : n;
}

function clean(s: string | undefined): string {
  return (s ?? "").trim();
}

export interface ParseResult {
  rows: ParsedProductRow[];
  missingHeader: boolean; // aucune colonne « name » reconnue
}

export function parseProductsCsv(text: string): ParseResult {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length) return { rows: [], missingHeader: true };

  const header = splitCsvLine(lines[0]).map(normHeader);
  const colOf = (field: TemplateColumn): number => {
    const aliases = HEADER_ALIASES[field];
    return header.findIndex((h) => aliases.includes(h));
  };
  const idx: Record<TemplateColumn, number> = {
    name: colOf("name"),
    name_fr: colOf("name_fr"),
    category: colOf("category"),
    unit: colOf("unit"),
    purchase_price: colOf("purchase_price"),
    sale_price: colOf("sale_price"),
    traiteur_price: colOf("traiteur_price"),
    vat_rate: colOf("vat_rate"),
    supplier: colOf("supplier"),
  };

  if (idx.name < 0) return { rows: [], missingHeader: true };

  const rows: ParsedProductRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const name = clean(cells[idx.name]);
    if (!name) continue;
    rows.push({
      name,
      name_fr: idx.name_fr >= 0 && clean(cells[idx.name_fr]) ? clean(cells[idx.name_fr]) : null,
      category: idx.category >= 0 && clean(cells[idx.category]) ? clean(cells[idx.category]) : null,
      unit: idx.unit >= 0 && clean(cells[idx.unit]) ? clean(cells[idx.unit]) : null,
      purchase_price: idx.purchase_price >= 0 ? num(cells[idx.purchase_price]) : 0,
      sale_price: idx.sale_price >= 0 ? num(cells[idx.sale_price]) : 0,
      traiteur_price: idx.traiteur_price >= 0 && clean(cells[idx.traiteur_price]) ? num(cells[idx.traiteur_price]) : null,
      vat_rate: idx.vat_rate >= 0 ? num(cells[idx.vat_rate]) : 0,
      supplier: idx.supplier >= 0 && clean(cells[idx.supplier]) ? clean(cells[idx.supplier]) : null,
    });
  }
  return { rows, missingHeader: false };
}

// Contenu du fichier modèle proposé au téléchargement.
export function buildTemplateCsv(): string {
  const header = TEMPLATE_COLUMNS.join(",");
  const examples = [
    ["موتزاريلا 1 كيلو", "Mozzarella 1 kg", "Fromages", "1 kg", "39.17", "43.17", "41.17", "20", "Nom du fournisseur"],
    ["كتشوب 2 كيلو", "Ketchup 2 kg", "Sauces", "2 kg", "14.17", "17.17", "", "20", ""],
  ];
  const rows = examples.map((r) =>
    r.map((c) => (/[",;\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")
  );
  return "﻿" + [header, ...rows].join("\r\n") + "\r\n";
}
