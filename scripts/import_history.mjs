// =====================================================================
// Import de l'historique Excel « Situation - MM_2026.xlsx » (avril → août 2026).
//
// Lancement (simulation, n'écrit rien) :
//   node --env-file=.env.local scripts/import_history.mjs <dossier des fichiers .xlsx>
// Écriture réelle :
//   node --env-file=.env.local scripts/import_history.mjs <dossier> --apply
//
// Non destructif : n'ajoute que les ventes / paiements absents. Une vente déjà
// présente avec une quantité différente est signalée et laissée telle quelle.
// Décisions prises avec l'utilisateur (oct. 2026) :
//   - Yassine (juin–juillet) est enregistré sous le vendeur Mohamed ;
//   - les totaux saisis à la main sans détail (Traiteur mai/juillet/août, Yassine juin) sont ignorés ;
//   - mai / Hamza : les 3 colonnes = samedis 9, 16 et 23 mai (le 30 vide, Aïd) ;
//   - paiements fournisseurs d'avril à juin ignorés (colonnes sans nom de fournisseur) ;
//   - charges des mois passés ignorées.
//
// Options (base de production, catalogue renommé) :
//   --map=scripts/prod_product_map.json   libellé Excel → produit du catalogue (nom ou désignation FR ; null = ignoré)
//   --skip=2026-08:Hamza                  ignore un vendeur pour un mois (déjà saisi dans l'app)
//   --no-create                           ne crée pas de produit : les ventes de produits inconnus sont ignorées
// Les prix Excel sont TTC : ils sont convertis en HT selon le taux de TVA du produit (sans effet si TVA = 0).
// =====================================================================
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const APPLY = process.argv.includes("--apply");
const NO_CREATE = process.argv.includes("--no-create");
const opt = (name) => process.argv.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));
const MAP_FILE = opt("map")[0];
const SKIP = new Set(opt("skip").map((s) => s.toLowerCase()));
if (!dir || dir.startsWith("--")) {
  console.error("Usage : node --env-file=.env.local scripts/import_history.mjs <dossier> [--apply] [--map=…] [--skip=AAAA-MM:Vendeur] [--no-create]");
  process.exit(1);
}
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Colonnes sans date (ou avec une date erronée) : date fixée à la main
const MONTHS = {
  // Traiteur d'avril non importé : ancienne gamme (boissons, épicerie), seuls les produits de la mer comptent
  "2026-04": {
    sellers: [{ sheet: "Ventes - Hamza", seller: "Hamza", layout: "old" }],
  },
  "2026-05": {
    sellers: [
      {
        sheet: "Ventes - Hamza",
        seller: "Hamza",
        layout: "old",
        dates: { C: "2026-05-09", D: "2026-05-16", E: "2026-05-23" },
      },
    ],
  },
  "2026-06": {
    sellers: [
      { sheet: "Ventes - Hamza", seller: "Hamza", layout: "new" },
      { sheet: "Ventes - Yassine", seller: "Mohamed", layout: "new" },
    ],
    traiteur: true,
  },
  "2026-07": {
    sellers: [
      { sheet: "Ventes - Hamza", seller: "Hamza", layout: "new", dates: { H: "2026-07-18", I: "2026-07-25" } },
      { sheet: "Ventes - Yassine", seller: "Mohamed", layout: "new", dates: { K: "2026-07-25", L: "2026-07-28" } },
    ],
    payments: true,
  },
  "2026-08": {
    sellers: [
      { sheet: "Ventes - Hamza", seller: "Hamza", layout: "new" },
      // En-tête « 15/07 » copié du mois de juillet : c'est le 15 août
      { sheet: "Ventes - Mohamed", seller: "Mohamed", layout: "new", dates: { H: "2026-08-15" } },
    ],
  },
};
// Ventes d'août importées par seed.mjs à la mauvaise date (en-tête « 15/07 »)
const DATE_FIXES = [{ seller: "Mohamed", from: "2026-07-15", to: "2026-08-15", sourceMonth: "2026-08" }];

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const pad = (n) => String(n).padStart(2, "0");
const colIndex = (c) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const colName = (i) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const isNum = (v) => typeof v === "number" && !Number.isNaN(v);
const round = (n) => Math.round(n * 100) / 100;

// ---------- lecture xlsx (valeurs en cache des formules) ----------
async function readWorkbook(file) {
  const zip = await JSZip.loadAsync(readFileSync(file));
  const dec = (s) =>
    s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const ssFile = zip.file("xl/sharedStrings.xml");
  const ss = ssFile ? await ssFile.async("string") : "";
  const strings = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    dec([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""))
  );
  const wb = await zip.file("xl/workbook.xml").async("string");
  const rels = await zip.file("xl/_rels/workbook.xml.rels").async("string");
  const sheets = {};
  for (const [, tag] of wb.matchAll(/<sheet ([^>]*)\/>/g)) {
    const name = dec(tag.match(/name="([^"]+)"/)[1]);
    const rid = tag.match(/r:id="([^"]+)"/)[1];
    const rel = [...rels.matchAll(/<Relationship ([^>]*)\/>/g)].map((m) => m[1]).find((r) => r.includes(`Id="${rid}"`));
    const xml = await zip.file("xl/" + rel.match(/Target="([^"]+)"/)[1].replace(/^\/?xl\//, "")).async("string");
    const rows = {};
    for (const [, r, body] of xml.matchAll(/<row [^>]*?r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      for (const [, col, attrs, inner] of body.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        if (!inner) continue;
        const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let val;
        if (/t="s"/.test(attrs)) val = strings[+v];
        else if (/t="inlineStr"/.test(attrs)) val = dec(inner.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? "");
        else if (/t="(str|e|b)"/.test(attrs)) val = v == null ? null : dec(v);
        else val = v == null ? null : Number(v);
        if (val === null || val === "") continue;
        (rows[+r] ??= {})[col] = val;
      }
    }
    sheets[name] = rows;
  }
  return sheets;
}

function serialToDate(n) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Date d'un en-tête de colonne ; corrige l'inversion jour/mois d'Excel. */
function headerDate(v, month) {
  let date = null;
  if (isNum(v) && v > 40000) date = serialToDate(v);
  else if (typeof v === "string") {
    const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})$/);
    if (m) date = `${month.slice(0, 4)}-${pad(+m[2])}-${pad(+m[1])}`;
  }
  if (!date) return null;
  if (date.startsWith(month)) return date;
  const [y, a, b] = date.split("-");
  const swapped = `${y}-${b}-${a}`;
  return swapped.startsWith(month) ? swapped : `INVALID:${date}`;
}

const lastDay = (month) => new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();

// ---------- parsing ----------
const issues = [];
const parsedProducts = new Map(); // norm(nom) → infos du premier mois où il apparaît
const firstPurchase = new Map(); // norm(nom) → premier prix d'achat connu

function noteProduct(name, info) {
  const k = norm(name);
  if (!parsedProducts.has(k)) parsedProducts.set(k, { name: name.replace(/\s+/g, " ").trim(), ...info });
}

/** Feuille vendeur → lignes { name, date, qty, pa, pv } */
function parseSellerSheet(rows, cfg, month) {
  const headerRow = Object.keys(rows).map(Number).sort((a, b) => a - b).find((r) => norm(rows[r].A) === "produit");
  const header = rows[headerRow];
  const totalCol = Object.entries(header).find(([, v]) => norm(v) === "total")?.[0];
  const firstQty = cfg.layout === "old" ? 2 : 4; // C ou E
  const qtyCols = [];
  for (let i = firstQty; i < colIndex(totalCol); i++) {
    const c = colName(i);
    const date = cfg.dates?.[c] ?? headerDate(header[c], month);
    qtyCols.push({ c, date });
  }
  const out = [];
  let category = null;
  for (const r of Object.keys(rows).map(Number).filter((r) => r > headerRow).sort((a, b) => a - b)) {
    const row = rows[r];
    const name = typeof row.A === "string" ? row.A : null;
    const pv = cfg.layout === "old" ? row.B : row.C;
    const pa = cfg.layout === "old" ? null : row.B;
    if (name && !isNum(pv)) {
      category = name.trim();
      continue;
    }
    if (!name) continue;
    noteProduct(name, { category, purchase_price: pa ?? 0, sale_price: pv });
    if (isNum(pa) && !firstPurchase.has(norm(name))) firstPurchase.set(norm(name), pa);
    for (const { c, date } of qtyCols) {
      const q = row[c];
      if (q === undefined || q === 0) continue;
      if (!isNum(q)) {
        issues.push(`${month} ${cfg.sheet} ligne ${r} col ${c} : quantité en texte « ${q} » ignorée (Excel ne la compte pas non plus)`);
        continue;
      }
      if (!date || date.startsWith("INVALID")) {
        issues.push(`${month} ${cfg.sheet} col ${c} (en-tête « ${header[c] ?? ""} ») : date inconnue → ${q} × ${name.trim()} ignoré`);
        continue;
      }
      out.push({ name, date, qty: q, pa, pv, seller: cfg.seller });
    }
  }
  return { rows: out, cols: qtyCols, sheetTotal: rows[Math.max(...Object.keys(rows).map(Number))] };
}

/** Feuille Traiteur : colonnes = jours 1, 2, 3… (avril commence à « 00 » → décalé d'un jour) */
function parseTraiteurSheet(rows, month) {
  const header = rows[2];
  const totalCol = Object.entries(header).find(([, v]) => norm(v) === "total")?.[0];
  const out = [];
  for (const r of Object.keys(rows).map(Number).filter((r) => r > 2)) {
    const row = rows[r];
    if (typeof row.B !== "string" || !isNum(row.D)) continue;
    noteProduct(row.B, { category: "Traiteur", unit: row.A ?? null, purchase_price: row.C ?? 0, sale_price: row.D, traiteur: true });
    for (let i = 4; i < colIndex(totalCol); i++) {
      const q = row[colName(i)];
      if (q === undefined || q === 0) continue;
      const day = i - 3;
      if (day > lastDay(month)) {
        issues.push(`${month} Traiteur ligne ${r} : jour ${day} hors du mois`);
        continue;
      }
      out.push({ name: row.B, date: `${month}-${pad(day)}`, qty: q, pa: row.C ?? 0, pv: row.D, seller: "Traiteur" });
    }
  }
  return out;
}

function parsePayments(rows, month) {
  const names = rows[4];
  const out = [];
  for (let r = 5; r <= 35; r++) {
    const day = r - 4;
    if (day > lastDay(month)) continue;
    for (const [c, supplier] of Object.entries(names)) {
      const v = rows[r]?.[c];
      if (isNum(v) && v !== 0) out.push({ supplier, date: `${month}-${pad(day)}`, amount: v });
    }
  }
  return out;
}

// ---------- DB ----------
async function all(table, columns = "*") {
  const res = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    res.push(...data);
    if (data.length < 1000) return res;
  }
}

async function main() {
  console.log(APPLY ? "=== IMPORT RÉEL ===" : "=== SIMULATION (rien n'est écrit ; ajoutez --apply pour importer) ===");
  const files = readdirSync(dir).filter((f) => /\.xlsx$/i.test(f));
  const fileFor = (month) => {
    const mm = month.slice(5);
    const f = files.filter((f) => f.includes(` ${mm}_${month.slice(0, 4)}`)).sort((a, b) => b.length - a.length)[0];
    if (!f) throw new Error(`Fichier introuvable pour ${month}`);
    return join(dir, f);
  };

  // 1. Lecture (juin → août d'abord pour connaître les prix d'achat, utilisés pour avril/mai)
  const order = ["2026-06", "2026-07", "2026-08", "2026-04", "2026-05"];
  const sales = [];
  const payments = [];
  const checks = [];
  for (const month of order) {
    const cfg = MONTHS[month];
    const wb = await readWorkbook(fileFor(month));
    for (const s of cfg.sellers) {
      const { rows, cols, sheetTotal } = parseSellerSheet(wb[s.sheet], s, month);
      for (const r of rows) r.month = month;
      sales.push(...rows);
      checks.push({ month, seller: s.seller, sheet: s.sheet, rows, cols, sheetTotal });
    }
    if (cfg.traiteur) {
      const rows = parseTraiteurSheet(wb["Ventes - Traiteur"], month);
      for (const r of rows) r.month = month;
      sales.push(...rows);
      checks.push({ month, seller: "Traiteur", sheet: "Ventes - Traiteur", rows });
    }
    if (cfg.payments) payments.push(...parsePayments(wb["Paiement Fournisseurs"], month));
  }
  // Prix d'achat d'avril/mai (non saisis dans ces fichiers) : premier prix connu
  for (const s of sales) if (s.pa === null) s.pa = firstPurchase.get(norm(s.name)) ?? null;

  // 2. Données existantes
  const sellers = await all("sellers");
  const sellerId = new Map(sellers.map((s) => [norm(s.name), s.id]));
  const products = await all("products");
  const productId = new Map();
  for (const p of products) {
    productId.set(norm(p.name), p);
    if (p.name_fr) productId.set(norm(p.name_fr), p);
  }
  // Libellés d'avril/mai → produit du catalogue
  for (const [alias, name] of [
    ["Sachets Ketchup", "كتشوب 10 غرام"],
    ["Sachets Mayonnaise", "مايونيص 10 غرام"],
  ]) {
    if (productId.has(norm(name))) productId.set(norm(alias), productId.get(norm(name)));
  }
  // Correspondances fournies (--map) : prioritaires sur les noms identiques
  const ignored = new Set();
  if (MAP_FILE) {
    for (const [label, target] of Object.entries(JSON.parse(readFileSync(MAP_FILE, "utf-8")))) {
      if (target === null) ignored.add(norm(label));
      else if (productId.has(norm(target))) productId.set(norm(label), productId.get(norm(target)));
      else throw new Error(`--map : produit « ${target} » introuvable dans le catalogue`);
    }
  }
  const vatOf = (name) => 1 + Number(productId.get(norm(name))?.vat_rate ?? 0) / 100;
  for (const s of sales) {
    // Prix du catalogue = HT → ramené en TTC comme les prix Excel
    if (s.pa === null) s.pa = Number(productId.get(norm(s.name))?.purchase_price ?? 0) * vatOf(s.name);
    if (SKIP.has(`${s.month}:${norm(s.seller)}`)) s.skip = "vendeur/mois ignoré (--skip)";
    else if (ignored.has(norm(s.name))) s.skip = "produit ignoré (--map)";
    else if (NO_CREATE && !productId.has(norm(s.name))) s.skip = "produit absent du catalogue (--no-create)";
  }
  const suppliers = await all("suppliers");
  const supplierId = new Map(suppliers.map((s) => [norm(s.name), s.id]));
  // Fournisseurs renommés (en-têtes Excel → nom actuel)
  for (const [alias, name] of [["FC", "Frais Caprices"], ["Adnane", "ILYASRIMAS FISH"], ["Itabi Fish", "ITABIFISH SARL-AU"]]) {
    if (supplierId.has(norm(name))) supplierId.set(norm(alias), supplierId.get(norm(name)));
  }

  // 3. Rapport par mois / vendeur, comparé aux totaux du fichier Excel (montants TTC)
  console.log("\n--- Chiffre d'affaires TTC importé vs fichier Excel ---");
  for (const c of checks) {
    const kept = c.rows.filter((r) => !r.skip);
    const ca = kept.reduce((t, r) => t + r.qty * r.pv, 0);
    const ben = kept.reduce((t, r) => t + r.qty * (r.pv - (r.pa ?? 0)), 0);
    const skipped = c.rows.filter((r) => r.skip).reduce((t, r) => t + r.qty * r.pv, 0);
    const dates = [...new Set(kept.map((r) => r.date))].sort();
    const caCell = c.sheetTotal ? Object.values(c.sheetTotal).filter(isNum) : [];
    const sheetCa = c.sheet === "Ventes - Traiteur" ? null : caCell.find((v) => v > 1000);
    console.log(
      `${c.month} ${c.seller.padEnd(8)} (${c.sheet.padEnd(17)}) CA ${round(ca).toLocaleString("fr-FR").padStart(12)}` +
        `  bénéfice ${round(ben).toLocaleString("fr-FR").padStart(10)}` +
        (sheetCa ? `  | Excel CA ${sheetCa.toLocaleString("fr-FR")}` : "") +
        (skipped ? `  | ignoré ${round(skipped).toLocaleString("fr-FR")}` : "") +
        `  | jours : ${dates.map((d) => d.slice(8)).join(", ")}`
    );
  }
  const skippedProducts = {};
  for (const s of sales.filter((s) => s.skip && !s.skip.startsWith("vendeur"))) {
    const k = s.name.replace(/\s+/g, " ").trim();
    skippedProducts[k] = (skippedProducts[k] ?? 0) + s.qty * s.pv;
  }
  if (Object.keys(skippedProducts).length) {
    console.log(`\n--- Produits ignorés : ${Object.keys(skippedProducts).length} ---`);
    for (const [k, v] of Object.entries(skippedProducts)) console.log(`  ${k}  (CA ${round(v).toLocaleString("fr-FR")})`);
  }
  sales.splice(0, sales.length, ...sales.filter((s) => !s.skip));

  // 4. Produits manquants → créés inactifs (anciens articles)
  const missing = [...parsedProducts.entries()].filter(([k]) => !productId.has(k)).filter(([k]) => sales.some((s) => norm(s.name) === k));
  console.log(`\n--- Produits absents du catalogue : ${missing.length} (créés en « inactif ») ---`);
  for (const [, p] of missing) console.log(`  ${p.name}  [${p.category ?? ""}]  PA ${p.purchase_price}  PV ${p.sale_price}`);

  // 5. Correction de date (août / Mohamed « 15/07 »)
  const existingSales = await all("sales", "id,product_id,seller_id,sale_date,quantity");
  const fixes = [];
  for (const f of DATE_FIXES) {
    const sid = sellerId.get(norm(f.seller));
    // Déjà corrigé si des ventes existent à la date cible (le 15/07 contient alors les vraies ventes de juillet)
    const done = existingSales.some((s) => s.seller_id === sid && s.sale_date === f.to);
    const rows = done ? [] : existingSales.filter((s) => s.seller_id === sid && s.sale_date === f.from);
    fixes.push({ ...f, rows });
    for (const r of rows) r.sale_date = f.to; // simulation de l'état après correction
  }
  for (const f of fixes) console.log(`\n--- Correction de date : ${f.rows.length} vente(s) ${f.seller} du ${f.from} → ${f.to} ---`);

  // 6. Ventes à ajouter
  const existingKey = new Map(existingSales.map((s) => [`${s.product_id}|${s.seller_id}|${s.sale_date}`, s]));
  const toInsert = new Map();
  let already = 0;
  const conflicts = [];
  const resolve = (name) => productId.get(norm(name))?.id ?? `NEW:${norm(name)}`;
  for (const s of sales) {
    const key = `${resolve(s.name)}|${sellerId.get(norm(s.seller))}|${s.date}`;
    const ex = existingKey.get(key);
    if (ex) {
      if (Number(ex.quantity) === s.qty) already++;
      else conflicts.push(`${s.date} ${s.seller} ${s.name.trim()} : base ${ex.quantity}, Excel ${s.qty}`);
      continue;
    }
    const prev = toInsert.get(key);
    if (prev) {
      // Deux libellés Excel → même produit (ex. cacher rouge + blanc) : quantités additionnées, prix moyens pondérés
      const q = prev.quantity + s.qty;
      prev.sale_price = (prev.sale_price * prev.quantity + s.pv * s.qty) / q;
      prev.purchase_price = (prev.purchase_price * prev.quantity + (s.pa ?? 0) * s.qty) / q;
      prev.quantity = q;
      issues.push(`${s.month} ${s.seller} ${s.name.trim()} regroupé avec un autre libellé le ${s.date} : quantités additionnées`);
    } else toInsert.set(key, { name: s.name, seller: s.seller, sale_date: s.date, quantity: s.qty, purchase_price: s.pa ?? 0, sale_price: s.pv });
  }
  const byMonth = {};
  for (const r of toInsert.values()) byMonth[r.sale_date.slice(0, 7)] = (byMonth[r.sale_date.slice(0, 7)] ?? 0) + 1;
  console.log(`\n--- Ventes : ${toInsert.size} à ajouter ${JSON.stringify(byMonth)}, ${already} déjà présentes ---`);
  if (conflicts.length) {
    console.log(`⚠️  ${conflicts.length} vente(s) déjà en base avec une autre quantité (non modifiées) :`);
    conflicts.forEach((c) => console.log("  " + c));
  }

  // 7. Paiements fournisseurs
  const existingPay = await all("supplier_payments", "supplier_id,pay_date,amount");
  const seenPay = new Set(existingPay.map((p) => `${p.supplier_id}|${p.pay_date}|${Number(p.amount)}`));
  const payRows = [];
  for (const p of payments) {
    const sid = supplierId.get(norm(p.supplier));
    if (!sid) {
      issues.push(`Fournisseur « ${p.supplier} » inconnu : paiement ${p.amount} du ${p.date} ignoré`);
      continue;
    }
    if (!seenPay.has(`${sid}|${p.date}|${p.amount}`)) payRows.push({ supplier_id: sid, pay_date: p.date, amount: p.amount, supplier: p.supplier });
  }
  const payTotal = payRows.reduce((t, p) => t + p.amount, 0);
  console.log(`\n--- Paiements fournisseurs : ${payRows.length} à ajouter (total ${payTotal.toLocaleString("fr-FR")}) ---`);
  for (const p of payRows) console.log(`  ${p.pay_date}  ${p.supplier.padEnd(12)} ${p.amount.toLocaleString("fr-FR")}`);

  if (issues.length) {
    console.log(`\n--- Remarques (${issues.length}) ---`);
    issues.forEach((i) => console.log("  " + i));
  }

  if (!APPLY) {
    console.log("\nSimulation terminée. Relancez avec --apply pour importer.");
    return;
  }

  // ---------- écriture ----------
  if (missing.length) {
    const maxOrder = products.reduce((m, p) => Math.max(m, p.sort_order ?? 0), 0);
    const payload = missing.map(([, p], i) => ({
      name: p.name,
      category: p.category,
      unit: p.unit ?? null,
      purchase_price: p.purchase_price || 0,
      sale_price: p.sale_price || 0,
      traiteur_price: p.traiteur ? p.sale_price : null,
      active: false,
      sort_order: maxOrder + i + 1,
    }));
    const { data, error } = await supabase.from("products").insert(payload).select();
    if (error) throw error;
    for (const p of data) productId.set(norm(p.name), p);
    console.log(`✅ ${data.length} produit(s) créé(s)`);
  }
  for (const f of fixes) {
    if (!f.rows.length) continue;
    const { error } = await supabase.from("sales").update({ sale_date: f.to }).in("id", f.rows.map((r) => r.id));
    if (error) throw error;
    console.log(`✅ ${f.rows.length} vente(s) déplacée(s) au ${f.to}`);
  }
  // Prix Excel TTC → HT (le catalogue stocke du HT, l'app rajoute la TVA du produit)
  const salePayload = [...toInsert.values()].map((r) => ({
    product_id: productId.get(norm(r.name)).id,
    seller_id: sellerId.get(norm(r.seller)),
    sale_date: r.sale_date,
    quantity: r.quantity,
    purchase_price: round(r.purchase_price / vatOf(r.name)),
    sale_price: round(r.sale_price / vatOf(r.name)),
  }));
  for (let i = 0; i < salePayload.length; i += 500) {
    const { error } = await supabase
      .from("sales")
      .upsert(salePayload.slice(i, i + 500), { onConflict: "product_id,seller_id,sale_date", ignoreDuplicates: true });
    if (error) throw error;
  }
  console.log(`✅ ${salePayload.length} vente(s) ajoutée(s)`);
  if (payRows.length) {
    const { error } = await supabase.from("supplier_payments").insert(payRows.map(({ supplier, ...p }) => p));
    if (error) throw error;
    console.log(`✅ ${payRows.length} paiement(s) fournisseur ajouté(s)`);
  }
  console.log("\n🎉 Import terminé.");
}

main().catch((e) => {
  console.error("❌ Erreur:", e.message || e);
  process.exit(1);
});
