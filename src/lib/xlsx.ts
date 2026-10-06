import JSZip from "jszip";

// Lecture / écriture minimales de classeurs .xlsx (sans dépendance lourde) :
// suffisant pour les modèles d'import (texte + nombres, en-tête en gras).

export type Cell = string | number | null;

export interface SheetData {
  name: string;
  rows: Cell[][];
  colWidths?: number[];
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function colIndex(ref: string): number {
  const letters = ref.replace(/[0-9]/g, "");
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

function sheetXml(sheet: SheetData): string {
  const cols = sheet.colWidths?.length
    ? `<cols>${sheet.colWidths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const rows = sheet.rows
    .map((row, r) => {
      const cells = row
        .map((v, c) => {
          if (v === null || v === "") return "";
          const ref = `${colName(c)}${r + 1}`;
          const style = r === 0 ? ' s="1"' : "";
          if (typeof v === "number") return `<c r="${ref}"${style}><v>${v}</v></c>`;
          return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `${cols}<sheetData>${rows}</sheetData></worksheet>`
  );
}

export async function buildXlsx(sheets: SheetData[]): Promise<Blob> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      sheets
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join("") +
      `</Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
      sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
      `</sheets></workbook>`
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      sheets
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join("") +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`
  );
  zip.file(
    "xl/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
      `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
      `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
      `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
      `</styleSheet>`
  );
  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** Lit toutes les feuilles d'un .xlsx (navigateur uniquement : DOMParser). */
export async function readXlsx(data: ArrayBuffer): Promise<SheetData[]> {
  const zip = await JSZip.loadAsync(data);
  const parser = new DOMParser();
  const xml = async (path: string) => {
    const f = zip.file(path);
    return f ? parser.parseFromString(await f.async("string"), "application/xml") : null;
  };
  const byTag = (node: Document | Element, tag: string) => Array.from(node.getElementsByTagNameNS("*", tag));

  const shared: string[] = [];
  const ss = await xml("xl/sharedStrings.xml");
  if (ss) for (const si of byTag(ss, "si")) shared.push(byTag(si, "t").map((t) => t.textContent ?? "").join(""));

  const wb = await xml("xl/workbook.xml");
  const rels = await xml("xl/_rels/workbook.xml.rels");
  if (!wb || !rels) return [];
  const target = new Map(byTag(rels, "Relationship").map((r) => [r.getAttribute("Id"), r.getAttribute("Target") ?? ""]));

  const out: SheetData[] = [];
  for (const sh of byTag(wb, "sheet")) {
    const rid = sh.getAttribute("r:id") ?? sh.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    let path = target.get(rid) ?? "";
    path = path.startsWith("/") ? path.slice(1) : `xl/${path}`;
    const doc = await xml(path);
    if (!doc) continue;
    const rows: Cell[][] = [];
    for (const row of byTag(doc, "row")) {
      const r = Number(row.getAttribute("r") ?? rows.length + 1) - 1;
      const cells: Cell[] = [];
      for (const c of byTag(row, "c")) {
        const ref = c.getAttribute("r");
        const ci = ref ? colIndex(ref) : cells.length;
        const type = c.getAttribute("t");
        const v = byTag(c, "v")[0]?.textContent ?? null;
        let val: Cell = null;
        if (type === "s") val = v === null ? null : shared[Number(v)] ?? null;
        else if (type === "inlineStr") val = byTag(c, "t").map((t) => t.textContent ?? "").join("");
        else if (type === "str" || type === "b" || type === "e") val = v;
        else if (v !== null) val = Number(v);
        cells[ci] = val;
      }
      rows[r] = Array.from(cells, (x) => x ?? null);
    }
    out.push({ name: sh.getAttribute("name") ?? "", rows: Array.from(rows, (x) => x ?? []) });
  }
  return out;
}

/** Numéro de série Excel (jours depuis 1899-12-30) → YYYY-MM-DD */
export function excelSerialToDate(n: number): string {
  return new Date(Math.round((n - 25569) * 86_400_000)).toISOString().slice(0, 10);
}
