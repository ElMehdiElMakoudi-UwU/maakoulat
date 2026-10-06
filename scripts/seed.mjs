// =====================================================================
// Import des données Excel (seed_data.json) dans Supabase.
//
// Prérequis : variables d'environnement (dans .env.local, jamais dans ce fichier)
//   SUPABASE_URL              = https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY = clé "service_role" (Settings > API)
//
// Lancement :  npm run seed
// Non destructif et relançable : n'efface rien, ajoute seulement ce qui manque
// (vendeurs, fournisseurs, produits par nom ; ventes par produit/vendeur/jour).
// Catalogue partagé : un produit vendu par plusieurs vendeurs n'est créé qu'une fois.
// =====================================================================
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("❌ Définissez SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY dans .env.local.");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const data = JSON.parse(readFileSync(join(__dirname, "seed_data.json"), "utf-8"));
const MONTH = data.month || "2026-08"; // pour les jours du Traiteur

const norm = (s) => String(s ?? "").trim().toLowerCase();

// Le mois du Traiteur : les ventes sont indexées par n° de jour (1..14)
function traiteurDate(day) {
  return `${MONTH}-${String(day).padStart(2, "0")}`;
}

// Certaines dates du fichier Excel ont jour et mois inversés (ex : 2026-01-08 pour le 1er août).
// Si la date sort du mois importé et que l'inversion y retombe, on corrige.
function fixDate(date) {
  const [y, m, d] = date.split("-");
  if (`${y}-${m}` === MONTH) return date;
  const swapped = `${y}-${d}-${m}`;
  return swapped.startsWith(MONTH) ? swapped : date;
}

async function all(table, columns = "*") {
  const { data: rows, error } = await supabase.from(table).select(columns);
  if (error) throw error;
  return rows ?? [];
}

/** Insère les lignes dont la clé n'existe pas encore ; renvoie la map clé → id (existants + créés). */
async function ensure(table, rows, keyOf) {
  const existing = await all(table);
  const map = new Map(existing.map((r) => [keyOf(r), r.id]));
  const missing = rows.filter((r) => !map.has(keyOf(r)));
  if (missing.length) {
    const { data: out, error } = await supabase.from(table).insert(missing).select();
    if (error) throw error;
    for (const r of out) map.set(keyOf(r), r.id);
  }
  return { map, created: missing.length, existing: existing.length };
}

async function seedSellers() {
  const rows = [
    { name: "Hamza", kind: "retail", sort_order: 1 },
    { name: "Mohamed", kind: "retail", sort_order: 2 },
    { name: "Traiteur", kind: "traiteur", sort_order: 3 },
  ];
  const { map, created } = await ensure("sellers", rows, (r) => norm(r.name));
  console.log(`✅ Vendeurs : ${created} créé(s)`);
  return map;
}

async function seedSuppliers() {
  const existing = await all("suppliers");
  const maxOrder = existing.reduce((m, s) => Math.max(m, s.sort_order ?? 0), 0);
  const rows = data.suppliers.map((name, i) => ({ name, sort_order: maxOrder + i + 1 }));
  const { map, created } = await ensure("suppliers", rows, (r) => norm(r.name));
  console.log(`✅ Fournisseurs : ${created} créé(s), ${existing.length} existant(s) conservé(s)`);
  return map;
}

async function seedProducts() {
  // Catalogue partagé : on fusionne les produits des vendeurs retail par nom
  const byName = new Map();
  let order = 0;
  for (const prods of Object.values(data.sellers)) {
    for (const p of prods) {
      const k = norm(p.name);
      if (!byName.has(k))
        byName.set(k, {
          name: p.name.trim(),
          category: p.category || null,
          purchase_price: p.purchase_price || 0,
          sale_price: p.sale_price || 0,
          sort_order: ++order,
        });
    }
  }
  for (const p of data.traiteur) {
    const k = norm(p.name);
    if (byName.has(k)) {
      byName.get(k).traiteur_price = p.sale_price || null;
    } else {
      byName.set(k, {
        name: p.name.trim(),
        unit: p.unit || null,
        category: "Traiteur",
        purchase_price: p.purchase_price || 0,
        sale_price: p.sale_price || 0,
        traiteur_price: p.sale_price || null,
        sort_order: ++order,
      });
    }
  }
  const { map, created, existing } = await ensure("products", [...byName.values()], (r) => norm(r.name));
  console.log(`✅ Produits : ${created} créé(s), ${existing} existant(s)`);
  return map;
}

async function seedSales(sellers, products) {
  const rows = new Map();
  const add = (sellerName, src, date) => {
    for (const [d, qty] of Object.entries(src.sales || {})) {
      const sale_date = date(d);
      const product_id = products.get(norm(src.name));
      const seller_id = sellers.get(norm(sellerName));
      rows.set(`${product_id}|${seller_id}|${sale_date}`, {
        product_id,
        seller_id,
        sale_date,
        quantity: qty,
        purchase_price: src.purchase_price || 0,
        sale_price: src.sale_price || 0,
      });
    }
  };
  for (const [sellerName, prods] of Object.entries(data.sellers)) for (const p of prods) add(sellerName, p, fixDate);
  for (const p of data.traiteur) add("Traiteur", p, traiteurDate);

  const payload = [...rows.values()];
  for (let i = 0; i < payload.length; i += 500) {
    const { error } = await supabase
      .from("sales")
      .upsert(payload.slice(i, i + 500), { onConflict: "product_id,seller_id,sale_date", ignoreDuplicates: true });
    if (error) throw error;
  }
  console.log(`✅ Ventes : ${payload.length} ligne(s) (les ventes déjà saisies ne sont pas modifiées)`);
}

async function seedPayments(suppliers) {
  const existing = await all("supplier_payments");
  const seen = new Set(existing.map((p) => `${p.supplier_id}|${p.pay_date}|${Number(p.amount)}`));
  const rows = data.supplier_payments
    .map((p) => ({ supplier_id: suppliers.get(norm(p.supplier)), pay_date: p.date, amount: p.amount }))
    .filter((p) => p.supplier_id && !seen.has(`${p.supplier_id}|${p.pay_date}|${Number(p.amount)}`));
  if (rows.length) {
    const { error } = await supabase.from("supplier_payments").insert(rows);
    if (error) throw error;
  }
  console.log(`✅ Paiements fournisseurs : ${rows.length} ajouté(s)`);
}

async function seedCharges() {
  const rows = data.charges.map((c, i) => ({ label: c.label, amount: c.amount, month: null, sort_order: i + 1 }));
  const { created } = await ensure("charges", rows, (r) => `${norm(r.label)}|${r.month ?? ""}`);
  console.log(`✅ Charges : ${created} ajoutée(s)`);
}

async function main() {
  const sellers = await seedSellers();
  const suppliers = await seedSuppliers();
  const products = await seedProducts();
  await seedSales(sellers, products);
  await seedPayments(suppliers);
  await seedCharges();
  console.log("\n🎉 Import terminé.");
}

main().catch((e) => {
  console.error("❌ Erreur:", e.message || e);
  process.exit(1);
});
