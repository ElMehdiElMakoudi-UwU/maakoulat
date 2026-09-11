export type SellerKind = "retail" | "traiteur";

export interface Seller {
  id: string;
  name: string;
  kind: SellerKind;
  active: boolean;
  sort_order: number;
}

export interface Product {
  id: string;
  supplier_id: string | null;
  name: string;
  name_fr: string | null;
  category: string | null;
  unit: string | null;
  purchase_price: number;
  sale_price: number;
  traiteur_price: number | null;
  vat_rate: number;
  active: boolean;
  sort_order: number;
}

export interface Sale {
  id: string;
  product_id: string;
  seller_id: string;
  sale_date: string; // YYYY-MM-DD
  quantity: number;
  purchase_price: number;
  sale_price: number;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  contact_name: string | null;
  notes: string | null;
  active: boolean;
  sort_order: number;
}

export interface SupplierPayment {
  id: string;
  supplier_id: string;
  pay_date: string;
  amount: number;
  note: string | null;
}

export interface Charge {
  id: string;
  label: string;
  amount: number;
  month: string | null;
  active: boolean;
  sort_order: number;
}

export interface SupplierInvoice {
  id: string;
  supplier_id: string;
  inv_date: string;
  amount: number;
  note: string | null;
}

export type OrderStatus = "draft" | "sent" | "received";

export interface PurchaseOrder {
  id: string;
  bc_number: string | null;
  supplier_id: string | null;
  order_date: string; // YYYY-MM-DD
  vat_rate: number;
  status: OrderStatus;
  note: string | null;
  created_at?: string;
}

export interface PurchaseOrderItem {
  id: string;
  order_id: string;
  unit: string | null;
  designation: string;
  quantity: number;
  unit_price: number; // P.U. HT
  sort_order: number;
}

export interface Client {
  id: string;
  name: string;
  ice: string | null;
  if_num: string | null;
  rc: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  contact_name: string | null;
  wants_invoice: boolean;
  discount_rate: number; // % de remise sur le PU catalogue
  notes: string | null;
  active: boolean;
  sort_order: number;
}

export interface MonthlyVentilation {
  month: string;
  encaissement_total: number;
  auto_encaissement: boolean;
  note: string | null;
}

export interface VentilationTarget {
  id: string;
  month: string;
  client_id: string;
  target_ttc: number;
}

export type SalesInvoiceStatus = "draft" | "final";

export interface SalesInvoice {
  id: string;
  inv_number: number | null;
  month: string;
  client_id: string | null;
  client_name: string | null;
  client_ice: string | null;
  client_if: string | null;
  client_address: string | null;
  inv_date: string;
  target_ttc: number;
  discount_rate: number;
  status: SalesInvoiceStatus;
  note: string | null;
  created_at?: string;
}

export interface SalesInvoiceItem {
  id: string;
  invoice_id: string;
  product_id: string | null;
  designation: string;
  unit: string | null;
  quantity: number;
  unit_price: number;
  vat_rate: number;
  sort_order: number;
}

export interface BankStatement {
  id: string;
  filename: string | null;
  period_start: string | null;
  period_end: string | null;
  opening_balance: number;
  closing_balance: number;
  total_debit: number;
  total_credit: number;
  tx_count: number;
  imported_at: string;
}

export type BankDirection = "debit" | "credit";
export type BankTxKind = "encaissement" | "paiement_frs" | "apport" | "charge" | "autre";

export interface BankTransaction {
  id: string;
  statement_id: string | null;
  op_date: string; // YYYY-MM-DD
  value_date: string | null;
  label: string;
  op_ref: string | null;
  amount: number; // signé : négatif = débit
  direction: BankDirection;
  kind: BankTxKind;
  charge_cat: string | null;
  supplier_id: string | null;
  reconciled: boolean;
  payment_id: string | null;
  note: string | null;
  fingerprint: string;
  created_at?: string;
}

export interface MonthlySettings {
  month: string;
  ca_target: number;
  profit_target: number;
  opening_balance: number;
}
