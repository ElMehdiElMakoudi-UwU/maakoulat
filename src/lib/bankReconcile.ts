// =====================================================================
// Rapprochement d'un débit bancaire avec un fournisseur (pages Banque et TVA).
// Rapprocher = créer le paiement fournisseur correspondant + marquer la ligne
// du relevé "paiement_frs" ; annuler = supprimer ce paiement.
// =====================================================================

import type { createClient } from "@/lib/supabase/client";
import type { BankTransaction, BankTxKind } from "@/lib/types";

type Supa = ReturnType<typeof createClient>;
export type ReconcilePatch = Pick<BankTransaction, "supplier_id" | "reconciled" | "payment_id"> & { kind?: BankTxKind };

/** Rapproche `tx` avec `supplierId`. Renvoie le patch appliqué, ou null en cas d'échec. */
export async function reconcileTx(supabase: Supa, tx: BankTransaction, supplierId: string): Promise<ReconcilePatch | null> {
  const { data: pay, error } = await supabase
    .from("supplier_payments")
    .insert({
      supplier_id: supplierId,
      pay_date: tx.op_date,
      amount: Math.abs(Number(tx.amount)),
      note: `Relevé — ${tx.label}`,
      bank_transaction_id: tx.id,
    })
    .select()
    .single();
  if (error || !pay) return null;
  const patch: ReconcilePatch = {
    supplier_id: supplierId,
    reconciled: true,
    payment_id: (pay as { id: string }).id,
    kind: "paiement_frs",
  };
  await supabase.from("bank_transactions").update(patch).eq("id", tx.id);
  return patch;
}

/** Annule le rapprochement de `tx` (supprime le paiement fournisseur créé). */
export async function unreconcileTx(supabase: Supa, tx: BankTransaction): Promise<ReconcilePatch> {
  if (tx.payment_id) await supabase.from("supplier_payments").delete().eq("id", tx.payment_id);
  const patch: ReconcilePatch = { reconciled: false, payment_id: null, supplier_id: null };
  await supabase.from("bank_transactions").update(patch).eq("id", tx.id);
  return patch;
}
