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
  nav_analysis: { fr: "Analyse", ar: "التحليل" },
  nav_history: { fr: "Journal", ar: "السجل" },
  nav_treasury: { fr: "Trésorerie", ar: "الخزينة" },
  nav_reports: { fr: "Rapports", ar: "التقارير" },
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
  designation_fr: { fr: "Désignation (FR)", ar: "التسمية (بالفرنسية)" },
  vat: { fr: "TVA %", ar: "الضريبة %" },
  all_categories: { fr: "Toutes les catégories", ar: "كل الفئات" },
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

  // Gestion des fournisseurs (page dédiée)
  suppliers_manage_title: { fr: "Fournisseurs", ar: "الموردون" },
  add_supplier: { fr: "Ajouter un fournisseur", ar: "إضافة مورد" },
  edit_supplier: { fr: "Modifier le fournisseur", ar: "تعديل المورد" },
  new_supplier: { fr: "Nouveau fournisseur", ar: "مورد جديد" },
  confirm_delete_supplier: { fr: "Supprimer ce fournisseur et tout son historique ?", ar: "حذف هذا المورد وكل سجله؟" },
  no_suppliers: { fr: "Aucun fournisseur. Cliquez sur « Ajouter un fournisseur ».", ar: "لا يوجد موردون. اضغط « إضافة مورد »." },
  supplier_name: { fr: "Nom du fournisseur", ar: "اسم المورد" },
  phone: { fr: "Téléphone", ar: "الهاتف" },
  address: { fr: "Adresse", ar: "العنوان" },
  contact_name: { fr: "Personne à contacter", ar: "الشخص المسؤول" },
  active: { fr: "Actif", ar: "نشط" },
  inactive: { fr: "Inactif", ar: "غير نشط" },
  show_inactive: { fr: "Afficher les inactifs", ar: "عرض غير النشطين" },
  supplier_count: { fr: "fournisseurs", ar: "موردين" },
  total_due_all: { fr: "Total dû (tous fournisseurs)", ar: "إجمالي المستحق (كل الموردين)" },
  with_debt: { fr: "avec dette", ar: "مع دين" },

  // Fiche fournisseur & relevé de compte
  back_to_suppliers: { fr: "← Fournisseurs", ar: "← الموردون" },
  account_statement: { fr: "Relevé de compte", ar: "كشف الحساب" },
  statement_hint: { fr: "Historique des commandes et paiements, du plus ancien au plus récent.", ar: "سجل الطلبيات والمدفوعات، من الأقدم إلى الأحدث." },
  movement: { fr: "Mouvement", ar: "الحركة" },
  debit: { fr: "Commande (dû)", ar: "طلبية (مستحق)" },
  credit: { fr: "Paiement", ar: "دفعة" },
  running_balance: { fr: "Solde", ar: "الرصيد" },
  new_movement: { fr: "Nouveau mouvement", ar: "حركة جديدة" },
  type_invoice: { fr: "Commande / facture", ar: "طلبية / فاتورة" },
  type_payment: { fr: "Paiement", ar: "دفعة" },
  call: { fr: "Appeler", ar: "اتصال" },
  whatsapp: { fr: "WhatsApp", ar: "واتساب" },
  send_email: { fr: "E-mail", ar: "بريد" },
  no_movements: { fr: "Aucun mouvement enregistré.", ar: "لا توجد حركات مسجلة." },
  print_statement: { fr: "Imprimer le relevé", ar: "طباعة الكشف" },

  // Bons de commande
  nav_orders: { fr: "Bons de commande", ar: "سندات الطلب" },
  orders_title: { fr: "Bons de commande", ar: "سندات الطلب" },
  new_order: { fr: "Nouveau bon", ar: "سند جديد" },
  order: { fr: "Bon de commande", ar: "سند الطلب" },
  bc_number: { fr: "N° BC", ar: "رقم السند" },
  order_date: { fr: "Date", ar: "التاريخ" },
  status: { fr: "Statut", ar: "الحالة" },
  status_draft: { fr: "Brouillon", ar: "مسودة" },
  status_sent: { fr: "Envoyé", ar: "مُرسَل" },
  status_received: { fr: "Reçu", ar: "مُستلَم" },
  no_supplier: { fr: "— Sans fournisseur —", ar: "— بدون مورد —" },
  designation: { fr: "Désignation", ar: "التسمية" },
  unit_price_ht: { fr: "P.U. HT", ar: "ثمن الوحدة بدون ض" },
  line_total_ht: { fr: "Total HT", ar: "المجموع بدون ض" },
  add_line: { fr: "+ Ajouter une ligne", ar: "+ إضافة سطر" },
  total_ht: { fr: "Total HT", ar: "المجموع بدون الضريبة" },
  total_ttc: { fr: "Total TTC", ar: "المجموع بالضريبة" },
  vat_amount: { fr: "TVA", ar: "الضريبة" },
  print_order: { fr: "Imprimer / PDF", ar: "طباعة / PDF" },
  back_to_list: { fr: "← Retour", ar: "← رجوع" },
  order_saved: { fr: "Bon enregistré ✓", ar: "تم حفظ السند ✓" },
  lines_count: { fr: "lignes", ar: "أسطر" },
  pick_product: { fr: "Choisir un produit…", ar: "اختر منتجا…" },
  select_supplier: { fr: "— Choisir un fournisseur —", ar: "— اختر موردا —" },
  supplier_required: { fr: "Veuillez d'abord choisir un fournisseur.", ar: "يرجى اختيار مورد أولا." },
  select_supplier_first: { fr: "Choisissez d'abord un fournisseur", ar: "اختر موردا أولا" },
  no_products_supplier: { fr: "Aucun produit lié à ce fournisseur.", ar: "لا يوجد منتج مرتبط بهذا المورد." },
  change_supplier_warn: { fr: "Changer de fournisseur videra les lignes déjà saisies. Continuer ?", ar: "تغيير المورد سيمسح الأسطر المدخلة. متابعة؟" },
  send_email_btn: { fr: "Envoyer par email", ar: "إرسال بالبريد" },
  sending_email: { fr: "Envoi en cours…", ar: "جاري الإرسال…" },
  email_sent: { fr: "Email envoyé ✓", ar: "تم إرسال البريد ✓" },
  email_error: { fr: "Échec de l'envoi. Vérifiez la configuration Gmail.", ar: "فشل الإرسال. تحقق من إعدادات Gmail." },
  email_not_configured: { fr: "Envoi non configuré : ajoutez GMAIL_USER et GMAIL_APP_PASSWORD.", ar: "الإرسال غير مُعدّ: أضف GMAIL_USER و GMAIL_APP_PASSWORD." },
  no_supplier_email: { fr: "Ce fournisseur n'a pas d'email. Ajoutez-le dans sa fiche.", ar: "هذا المورد ليس له بريد. أضفه في بطاقته." },
  save_before_send: { fr: "Enregistrez d'abord le bon de commande.", ar: "احفظ سند الطلب أولا." },
  confirm_send_prefix: { fr: "Envoyer le bon de commande à", ar: "إرسال سند الطلب إلى" },
  confirm_delete_order: { fr: "Supprimer ce bon de commande ?", ar: "حذف سند الطلب؟" },
  empty_orders: { fr: "Aucun bon de commande. Cliquez sur « Nouveau bon ».", ar: "لا توجد سندات طلب. اضغط « سند جديد »." },
  duplicate: { fr: "Dupliquer", ar: "نسخ" },

  // Charges
  charges_title: { fr: "Charges fixes", ar: "المصاريف الثابتة" },
  add_charge: { fr: "Ajouter une charge", ar: "إضافة مصروف" },

  currency: { fr: "DH", ar: "درهم" },

  // Analyse
  analysis_title: { fr: "Analyse & pilotage", ar: "التحليل والقيادة" },
  daily_evolution: { fr: "Évolution quotidienne", ar: "التطور اليومي" },
  daily_evolution_hint: { fr: "CA et bénéfice jour par jour sur le mois.", ar: "المداخيل والربح يوما بيوم خلال الشهر." },
  monthly_comparison: { fr: "Comparaison mensuelle", ar: "المقارنة الشهرية" },
  monthly_comparison_hint: { fr: "6 derniers mois.", ar: "آخر 6 أشهر." },
  seller_comparison: { fr: "CA par vendeur et par mois", ar: "المداخيل حسب البائع والشهر" },
  margin_alerts: { fr: "Alertes marges", ar: "تنبيهات الهامش" },
  margin_alerts_hint: { fr: "Produits vendus ce mois avec une marge faible ou négative.", ar: "منتجات بيعت هذا الشهر بهامش ضعيف أو سلبي." },
  threshold: { fr: "Seuil", ar: "العتبة" },
  no_alerts: { fr: "Aucune alerte 👍", ar: "لا توجد تنبيهات 👍" },
  best_sellers: { fr: "Meilleures ventes", ar: "أفضل المبيعات" },
  dormant_products: { fr: "Produits sans vente ce mois", ar: "منتجات بدون مبيعات هذا الشهر" },
  day_col: { fr: "Jour", ar: "اليوم" },
  units: { fr: "unités", ar: "وحدة" },

  // Saisie & usage quotidien
  filter_all: { fr: "Tous", ar: "الكل" },
  filter_sold: { fr: "Vendus", ar: "المباعة" },
  duplicate_day: { fr: "Dupliquer un jour", ar: "نسخ يوم" },
  copy_from_date: { fr: "Copier les ventes depuis :", ar: "نسخ المبيعات من:" },
  copy: { fr: "Copier", ar: "نسخ" },
  copy_done: { fr: "Copié — vérifiez puis Enregistrer", ar: "تم النسخ — تحقق ثم احفظ" },
  copy_empty: { fr: "Aucune vente ce jour-là.", ar: "لا توجد مبيعات في ذلك اليوم." },
  today_btn: { fr: "Aujourd'hui", ar: "اليوم" },
  history_title: { fr: "Journal des ventes", ar: "سجل المبيعات" },
  history_hint: { fr: "Toutes les journées saisies. Cliquez pour corriger.", ar: "كل الأيام المسجلة. انقر للتصحيح." },
  edit_day: { fr: "Corriger", ar: "تصحيح" },
  nb_products: { fr: "produits", ar: "منتجات" },
  no_history: { fr: "Aucune vente enregistrée ce mois.", ar: "لا توجد مبيعات مسجلة هذا الشهر." },

  // Trésorerie
  treasury_title: { fr: "Trésorerie", ar: "الخزينة" },
  treasury_hint: { fr: "Entrées (CA) vs sorties (fournisseurs + charges).", ar: "المداخيل مقابل المصاريف (الموردون + المصاريف)." },
  inflows: { fr: "Entrées", ar: "المداخيل" },
  outflows: { fr: "Sorties", ar: "المصاريف" },
  balance: { fr: "Solde du mois", ar: "رصيد الشهر" },
  opening_balance: { fr: "Solde d'ouverture", ar: "الرصيد الافتتاحي" },
  closing_balance: { fr: "Solde de clôture", ar: "الرصيد الختامي" },
  cumulative_balance: { fr: "Solde cumulé", ar: "الرصيد التراكمي" },
  sales_revenue: { fr: "Ventes (CA)", ar: "المبيعات" },
  supplier_pay: { fr: "Paiements fournisseurs", ar: "مدفوعات الموردين" },
  save_settings: { fr: "Enregistrer", ar: "حفظ" },

  // Dettes fournisseurs
  ordered: { fr: "Commandé", ar: "المطلوب" },
  paid: { fr: "Payé", ar: "المدفوع" },
  to_pay: { fr: "Reste à payer", ar: "الباقي للدفع" },
  debts: { fr: "Dettes fournisseurs", ar: "ديون الموردين" },
  payments_tab: { fr: "Paiements", ar: "المدفوعات" },
  invoices_tab: { fr: "Commandes", ar: "الطلبيات" },
  add_invoice: { fr: "Ajouter une commande", ar: "إضافة طلبية" },

  // Charges par mois
  charge_type: { fr: "Type", ar: "النوع" },
  recurring: { fr: "Fixe (tous les mois)", ar: "ثابت (كل شهر)" },
  one_off: { fr: "Ponctuelle (ce mois)", ar: "ظرفية (هذا الشهر)" },
  recurring_short: { fr: "Fixe", ar: "ثابت" },
  one_off_short: { fr: "Ponctuelle", ar: "ظرفية" },

  // Objectifs
  targets: { fr: "Objectifs du mois", ar: "أهداف الشهر" },
  ca_target: { fr: "Objectif CA", ar: "هدف المداخيل" },
  profit_target: { fr: "Objectif bénéfice", ar: "هدف الربح" },
  of_target: { fr: "de l'objectif", ar: "من الهدف" },
  set_targets: { fr: "Définir les objectifs", ar: "تحديد الأهداف" },

  // Rapports & export
  reports_title: { fr: "Rapports", ar: "التقارير" },
  reports_hint: { fr: "Performances par vendeur, exportables et imprimables.", ar: "أداء كل بائع، قابل للتصدير والطباعة." },
  all_sellers: { fr: "Tous les vendeurs", ar: "كل البائعين" },
  export_csv: { fr: "Exporter CSV", ar: "تصدير CSV" },
  print_pdf: { fr: "Imprimer / PDF", ar: "طباعة / PDF" },
  report_title: { fr: "Rapport de performance", ar: "تقرير الأداء" },
  period: { fr: "Période", ar: "الفترة" },
  generated_on: { fr: "Généré le", ar: "أُنشئ في" },
  margin_rate: { fr: "Taux de marge", ar: "نسبة الهامش" },
  daily_detail: { fr: "Détail par jour", ar: "التفصيل اليومي" },
  rank: { fr: "#", ar: "#" },
  share_hint: { fr: "Astuce : « Imprimer » → « Enregistrer en PDF » pour partager sur WhatsApp.", ar: "نصيحة: «طباعة» ثم «حفظ PDF» للمشاركة عبر واتساب." },
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
