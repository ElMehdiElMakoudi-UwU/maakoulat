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
  seller_id: string;
  supplier_id: string | null;
  name: string;
  name_fr: string | null;
  category: string | null;
  unit: string | null;
  purchase_price: number;
  sale_price: number;
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

export interface MonthlySettings {
  month: string;
  ca_target: number;
  profit_target: number;
  opening_balance: number;
}
