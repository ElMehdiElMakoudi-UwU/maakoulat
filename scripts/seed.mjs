// =====================================================================
// Import des données Excel (seed_data.json) dans Supabase.
//
// Prérequis : variables d'environnement
//   SUPABASE_URL             = https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY = clé "service_role" (Settings > API)
//
// Lancement :  npm run seed
// (Relançable : vide d'abord les tables de données.)
// =====================================================================
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("❌ Définissez SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const data = JSON.parse(readFileSync(join(__dirname, "seed_data.json"), "utf-8"));
const MONTH = data.month || "2026-08"; // pour les jours du Traiteur

// Le mois du Traiteur : les ventes sont indexées par n° de jour (1..14)
function traiteurDate(day) {
  return `${MONTH}-${String(day).padStart(2, "0")}`;
}

async function wipe() {
  console.log("🧹 Nettoyage des tables...");
  // ordre : enfants -> parents
  for (const table of ["sales", "supplier_payments", "products", "charges", "suppliers", "sellers"]) {
    const { error } = await supabase.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) console.warn(`  ⚠️ ${table}: ${error.message}`);
  }
}

async function insertSellers() {
  const rows = [
    { name: "Hamza", kind: "retail", sort_order: 1 },
    { name: "Mohamed", kind: "retail", sort_order: 2 },
    { name: "Traiteur", kind: "traiteur", sort_order: 3 },
  ];
  const { data: out, error } = await supabase.from("sellers").insert(rows).select();
  if (error) throw error;
  const map = {};
  for (const s of out) map[s.name] = s.id;
  console.log("✅ Vendeurs:", Object.keys(map).join(", "));
  return map;
}

async function insertSuppliers() {
  const rows = data.suppliers.map((name, i) => ({ name, sort_order: i + 1 }));
  const { data: out, error } = await supabase.from("suppliers").insert(rows).select();
  if (error) throw error;
  const map = {};
  for (const s of out) map[s.name] = s.id;
  console.log("✅ Fournisseurs:", Object.keys(map).join(", "));
  return map;
}

async function insertRetail(sellerName, sellerId) {
  const prods = data.sellers[sellerName];
  const productRows = prods.map((p, i) => ({
    seller_id: sellerId,
    name: p.name,
    category: p.category || null,
    purchase_price: p.purchase_price || 0,
    sale_price: p.sale_price || 0,
    sort_order: i + 1,
  }));
  const { data: out, error } = await supabase.from("products").insert(productRows).select();
  if (error) throw error;

  const salesRows = [];
  out.forEach((prod, i) => {
    const src = prods[i];
    for (const [date, qty] of Object.entries(src.sales || {})) {
      salesRows.push({
        product_id: prod.id,
        seller_id: sellerId,
        sale_date: date,
        quantity: qty,
        purchase_price: src.purchase_price || 0,
        sale_price: src.sale_price || 0,
      });
    }
  });
  if (salesRows.length) {
    const { error: e2 } = await supabase.from("sales").insert(salesRows);
    if (e2) throw e2;
  }
  console.log(`✅ ${sellerName}: ${out.length} produits, ${salesRows.length} ventes`);
}

async function insertTraiteur(sellerId) {
  const prods = data.traiteur;
  const productRows = prods.map((p, i) => ({
    seller_id: sellerId,
    name: p.name,
    unit: p.unit || null,
    category: "Traiteur",
    purchase_price: p.purchase_price || 0,
    sale_price: p.sale_price || 0,
    sort_order: i + 1,
  }));
  const { data: out, error } = await supabase.from("products").insert(productRows).select();
  if (error) throw error;

  const salesRows = [];
  out.forEach((prod, i) => {
    const src = prods[i];
    for (const [day, qty] of Object.entries(src.sales || {})) {
      salesRows.push({
        product_id: prod.id,
        seller_id: sellerId,
        sale_date: traiteurDate(day),
        quantity: qty,
        purchase_price: src.purchase_price || 0,
        sale_price: src.sale_price || 0,
      });
    }
  });
  if (salesRows.length) {
    const { error: e2 } = await supabase.from("sales").insert(salesRows);
    if (e2) throw e2;
  }
  console.log(`✅ Traiteur: ${out.length} produits, ${salesRows.length} ventes`);
}

async function insertPayments(supMap) {
  const rows = data.supplier_payments
    .filter((p) => supMap[p.supplier])
    .map((p) => ({ supplier_id: supMap[p.supplier], pay_date: p.date, amount: p.amount }));
  if (rows.length) {
    const { error } = await supabase.from("supplier_payments").insert(rows);
    if (error) throw error;
  }
  console.log(`✅ Paiements fournisseurs: ${rows.length}`);
}

async function insertCharges() {
  const rows = data.charges.map((c, i) => ({
    label: c.label,
    amount: c.amount,
    month: null, // récurrentes
    sort_order: i + 1,
  }));
  const { error } = await supabase.from("charges").insert(rows);
  if (error) throw error;
  console.log(`✅ Charges: ${rows.length}`);
}

async function main() {
  await wipe();
  const sellers = await insertSellers();
  const suppliers = await insertSuppliers();
  await insertRetail("Hamza", sellers["Hamza"]);
  await insertRetail("Mohamed", sellers["Mohamed"]);
  await insertTraiteur(sellers["Traiteur"]);
  await insertPayments(suppliers);
  await insertCharges();
  console.log("\n🎉 Import terminé.");
}

main().catch((e) => {
  console.error("❌ Erreur:", e.message || e);
  process.exit(1);
});
