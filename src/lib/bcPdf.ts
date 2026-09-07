import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { COMPANY } from "./company";

export interface BcLine {
  unit: string;
  designation: string;
  quantity: number;
  unitPrice: number;
}

export interface BcPdfData {
  bcNumber: string;
  orderDate: string;
  supplierName: string;
  lines: BcLine[];
  totalHT: number;
  vatRate: number;
  vatAmount: number;
  totalTTC: number;
}

/** Format monétaire simple, latin (pas de RTL) pour un rendu propre dans le PDF. */
function money(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " DH";
}

/** Récupère le logo (public/) en data URL pour l'intégrer au PDF. */
export async function fetchLogoDataUrl(): Promise<string | null> {
  try {
    const res = await fetch(COMPANY.logoPath);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** Construit le PDF du bon de commande (mise en page reprise du modèle Excel). */
export function buildBcPdf(data: BcPdfData, logoDataUrl: string | null): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const red = [198, 40, 40] as const;

  // --- En-tête : nom société + logo ---
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...red);
  doc.text(COMPANY.name, margin, 20);

  if (logoDataUrl) {
    try {
      // logo carré ~26mm, aligné à droite
      doc.addImage(logoDataUrl, "JPEG", pageW - margin - 30, 8, 30, 21);
    } catch {
      /* logo optionnel */
    }
  }
  doc.setDrawColor(...red);
  doc.setLineWidth(0.6);
  doc.line(margin, 32, pageW - margin, 32);

  // --- Titre + infos ---
  doc.setTextColor(20, 20, 20);
  doc.setFontSize(13);
  doc.text(`BON DE COMMANDE${data.bcNumber ? `  N° ${data.bcNumber}` : ""}`, margin, 42);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90, 90, 90);
  doc.text(`Date : ${data.orderDate}`, margin, 49);
  doc.text(`Fournisseur : ${data.supplierName}`, pageW - margin, 49, { align: "right" });

  // --- Tableau des lignes ---
  autoTable(doc, {
    startY: 55,
    head: [["U", "Désignation", "Qté", "P.U. HT", "P.T. HT"]],
    body: data.lines.map((l) => [
      l.unit,
      l.designation,
      String(l.quantity),
      money(l.unitPrice),
      money(l.quantity * l.unitPrice),
    ]),
    styles: { fontSize: 9, cellPadding: 2, lineColor: [220, 220, 220], lineWidth: 0.1 },
    headStyles: { fillColor: [...red], textColor: 255, halign: "left", fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 18 },
      2: { halign: "right", cellWidth: 18 },
      3: { halign: "right", cellWidth: 28 },
      4: { halign: "right", cellWidth: 30 },
    },
    margin: { left: margin, right: margin },
  });

  // --- Totaux ---
  // @ts-expect-error lastAutoTable est ajouté par jspdf-autotable
  const afterTable: number = doc.lastAutoTable?.finalY ?? 60;
  let y = afterTable + 8;
  const labelX = pageW - margin - 60;
  const valX = pageW - margin;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(60, 60, 60);

  doc.text("Total H.T", labelX, y);
  doc.text(money(data.totalHT), valX, y, { align: "right" });
  y += 6;
  doc.text(`TVA ${data.vatRate}%`, labelX, y);
  doc.text(money(data.vatAmount), valX, y, { align: "right" });
  y += 7;
  doc.setDrawColor(200, 200, 200);
  doc.line(labelX, y - 4, valX, y - 4);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...red);
  doc.text("Total T.T.C", labelX, y);
  doc.text(money(data.totalTTC), valX, y, { align: "right" });

  // --- Pied de page ---
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(120, 120, 120);
  doc.setDrawColor(220, 220, 220);
  doc.line(margin, pageH - 20, pageW - margin, pageH - 20);
  doc.text(
    `Adresse : ${COMPANY.address}  .  Tél : ${COMPANY.tel}  .  Email : ${COMPANY.email}`,
    pageW / 2,
    pageH - 15,
    { align: "center" }
  );
  doc.text(
    `RC : ${COMPANY.rc}  .  Patente : ${COMPANY.patente}  .  IF : ${COMPANY.if}  .  ICE : ${COMPANY.ice}`,
    pageW / 2,
    pageH - 11,
    { align: "center" }
  );

  return doc;
}

/** PDF -> base64 (sans le préfixe data:) pour l'envoi à l'API email. */
export function pdfToBase64(doc: jsPDF): string {
  const dataUri = doc.output("datauristring");
  return dataUri.split(",")[1] ?? "";
}
