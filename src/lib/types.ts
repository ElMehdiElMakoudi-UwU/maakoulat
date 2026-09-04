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
  name: string;
  category: string | null;
  unit: string | null;
  purchase_price: number;
  sale_price: number;
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
