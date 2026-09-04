"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Lang = "fr" | "ar";

type Dict = Record<string, { fr: string; ar: string }>;

// Toutes les chaînes de l'interface (FR + AR)
export const DICT: Dict = {
  appName: { fr: "Maakoulat", ar: "معكولات" },
  tagline: { fr: "Gestion d'entreprise", ar: "تدبير الشركة" },

  // Navigation
  nav_dashboard: { fr: "Tableau de bord", ar: "لوحة القيادة" },
  nav_sales: { fr: "Saisie des ventes", ar: "تسجيل المبيعات" },
  nav_products: { fr: "Produits", ar: "المنتجات" },
  nav_suppliers: { fr: "Fournisseurs", ar: "الموردون" },
  nav_charges: { fr: "Charges", ar: "المصاريف" },
  logout: { fr: "Déconnexion", ar: "تسجيل الخروج" },

  // Auth
  login_title: { fr: "Connexion", ar: "تسجيل الدخول" },
  email: { fr: "E-mail", ar: "البريد الإلكتروني" },
  password: { fr: "Mot de passe", ar: "كلمة المرور" },
  signin: { fr: "Se connecter", ar: "دخول" },
  signing_in: { fr: "Connexion...", ar: "جاري الدخول..." },
  login_error: { fr: "E-mail ou mot de passe incorrect.", ar: "البريد أو كلمة المرور غير صحيحة." },

  // Général
  seller: { fr: "Vendeur", ar: "البائع" },
  date: { fr: "Date", ar: "التاريخ" },
  product: { fr: "Produit", ar: "المنتج" },
  category: { fr: "Catégorie", ar: "الفئة" },
  quantity: { fr: "Quantité", ar: "الكمية" },
  purchase_price: { fr: "Prix d'achat", ar: "ثمن الشراء" },
  sale_price: { fr: "Prix de vente", ar: "ثمن البيع" },
  unit: { fr: "Unité", ar: "الوحدة" },
  revenue: { fr: "Chiffre d'affaires", ar: "رقم المعاملات" },
  ca: { fr: "CA", ar: "المداخيل" },
  profit: { fr: "Bénéfice", ar: "الربح" },
  margin: { fr: "Marge", ar: "الهامش" },
  total: { fr: "Total", ar: "المجموع" },
  save: { fr: "Enregistrer", ar: "حفظ" },
  saving: { fr: "Enregistrement...", ar: "جاري الحفظ..." },
  saved: { fr: "Enregistré ✓", ar: "تم الحفظ ✓" },
  cancel: { fr: "Annuler", ar: "إلغاء" },
  add: { fr: "Ajouter", ar: "إضافة" },
  edit: { fr: "Modifier", ar: "تعديل" },
  delete: { fr: "Supprimer", ar: "حذف" },
  search: { fr: "Rechercher...", ar: "بحث..." },
  amount: { fr: "Montant", ar: "المبلغ" },
  name: { fr: "Nom", ar: "الاسم" },
  label: { fr: "Libellé", ar: "البيان" },
  actions: { fr: "Actions", ar: "إجراءات" },
  confirm_delete: { fr: "Confirmer la suppression ?", ar: "تأكيد الحذف؟" },
  no_data: { fr: "Aucune donnée", ar: "لا توجد بيانات" },
  loading: { fr: "Chargement...", ar: "جاري التحميل..." },

  // Ventes
  sales_entry_title: { fr: "Saisie des ventes du jour", ar: "تسجيل مبيعات اليوم" },
  sales_hint: { fr: "Saisissez les quantités vendues, le CA et le bénéfice se calculent automatiquement.", ar: "أدخل الكميات المباعة، وتحسب المداخيل والربح تلقائيا." },
  qty_sold: { fr: "Qté vendue", ar: "الكمية المباعة" },
  line_total: { fr: "Total ligne", ar: "مجموع السطر" },
  day_total: { fr: "Total du jour", ar: "مجموع اليوم" },
  items_sold: { fr: "produits vendus", ar: "منتجات مباعة" },

  // Dashboard
  dashboard_title: { fr: "Situation", ar: "الوضعية" },
  month: { fr: "Mois", ar: "الشهر" },
  by_seller: { fr: "Par vendeur", ar: "حسب البائع" },
  suppliers_paid: { fr: "Paiements fournisseurs", ar: "مدفوعات الموردين" },
  total_charges: { fr: "Total charges", ar: "مجموع المصاريف" },
  net_result: { fr: "Résultat net", ar: "النتيجة الصافية" },
  gross_profit: { fr: "Bénéfice brut", ar: "الربح الإجمالي" },
  top_products: { fr: "Meilleurs produits", ar: "أفضل المنتجات" },

  // Produits
  products_title: { fr: "Catalogue produits", ar: "كتالوج المنتجات" },
  add_product: { fr: "Ajouter un produit", ar: "إضافة منتج" },

  // Fournisseurs
  suppliers_title: { fr: "Fournisseurs & paiements", ar: "الموردون والمدفوعات" },
  add_payment: { fr: "Ajouter un paiement", ar: "إضافة دفعة" },
  supplier: { fr: "Fournisseur", ar: "المورد" },
  note: { fr: "Note", ar: "ملاحظة" },

  // Charges
  charges_title: { fr: "Charges fixes", ar: "المصاريف الثابتة" },
  add_charge: { fr: "Ajouter une charge", ar: "إضافة مصروف" },

  currency: { fr: "DH", ar: "درهم" },
};

interface I18nCtx {
  lang: Lang;
  dir: "ltr" | "rtl";
  t: (key: keyof typeof DICT | string) => string;
  setLang: (l: Lang) => void;
  toggle: () => void;
}

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("fr");

  useEffect(() => {
    const saved = (typeof window !== "undefined" && localStorage.getItem("lang")) as Lang | null;
    if (saved === "fr" || saved === "ar") setLangState(saved);
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem("lang", l);
    } catch {}
    document.documentElement.lang = l;
    document.documentElement.dir = l === "ar" ? "rtl" : "ltr";
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  const t = useCallback(
    (key: string) => {
      const entry = DICT[key];
      if (!entry) return key;
      return entry[lang];
    },
    [lang]
  );

  const toggle = useCallback(() => setLang(lang === "fr" ? "ar" : "fr"), [lang, setLang]);

  return (
    <Ctx.Provider value={{ lang, dir: lang === "ar" ? "rtl" : "ltr", t, setLang, toggle }}>
      {children}
    </Ctx.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
