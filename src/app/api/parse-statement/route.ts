import { NextResponse } from "next/server";
import { getDocumentProxy } from "unpdf";
import { createClient } from "@/lib/supabase/server";
import { parseStatement, type Page, type Tok } from "@/lib/bankStatement";

// pdfjs (via unpdf) : runtime Node.js.
export const runtime = "nodejs";
export const maxDuration = 30;

interface PdfItem {
  str: string;
  transform: number[];
  width: number;
}

/** Regroupe les items pdfjs en lignes (par ordonnée) puis en tokens positionnés. */
function pagesFromPdfItems(itemsByPage: PdfItem[][]): Page[] {
  return itemsByPage.map((items) => {
    // 1) lignes : items partageant ~la même ordonnée
    const lines: { y: number; items: PdfItem[] }[] = [];
    for (const it of items) {
      if (!it.str.trim()) continue;
      const y = it.transform[5];
      const line = lines.find((l) => Math.abs(l.y - y) <= 3);
      if (line) line.items.push(it);
      else lines.push({ y, items: [it] });
    }
    lines.sort((a, b) => b.y - a.y); // haut → bas

    // 2) tokens : découpe chaque item sur les espaces, x proportionnel
    return {
      rows: lines.map((l) => {
        const tokens: Tok[] = [];
        for (const it of l.items.sort((a, b) => a.transform[4] - b.transform[4])) {
          const x0 = it.transform[4];
          const len = Math.max(it.str.length, 1);
          const re = /\S+/g;
          let m: RegExpExecArray | null;
          while ((m = re.exec(it.str))) {
            tokens.push({ x: x0 + (m.index / len) * it.width, s: m[0] });
          }
        }
        tokens.sort((a, b) => a.x - b.x);
        return { tokens };
      }),
    };
  });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let bytes: Uint8Array;
  let filename = "releve.pdf";
  const ctype = req.headers.get("content-type") || "";
  try {
    if (ctype.includes("multipart/form-data")) {
      const fd = await req.formData();
      const file = fd.get("file");
      if (!(file instanceof File)) return NextResponse.json({ error: "missing_file" }, { status: 400 });
      filename = file.name || filename;
      bytes = new Uint8Array(await file.arrayBuffer());
    } else {
      const body = (await req.json()) as { pdfBase64?: string; filename?: string };
      if (!body.pdfBase64) return NextResponse.json({ error: "missing_file" }, { status: 400 });
      if (body.filename) filename = body.filename;
      bytes = new Uint8Array(Buffer.from(body.pdfBase64, "base64"));
    }
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  try {
    const pdf = await getDocumentProxy(bytes);
    const itemsByPage: PdfItem[][] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      itemsByPage.push(tc.items as PdfItem[]);
    }
    const parsed = parseStatement(pagesFromPdfItems(itemsByPage), filename);
    return NextResponse.json({ ok: true, filename, ...parsed });
  } catch (e) {
    console.error("parse-statement error:", e);
    return NextResponse.json({ error: "parse_failed" }, { status: 422 });
  }
}
