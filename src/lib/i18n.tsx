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
  nav_bank: { fr: "Banque", ar: "البنك" },
  nav_clients: { fr: "Clients", ar: "الزبناء" },
  nav_ventilation: { fr: "Ventilation", ar: "توزيع المداخيل" },
  nav_invoices: { fr: "Factures", ar: "الفواتير" },
  nav_reports: { fr: "Rapports", ar: "التقارير" },
  logout: { fr: "Déconnexion", ar: "تسجيل الخروج" },
  nav_group_main: { fr: "Activité", ar: "النشاط" },
  nav_group_finance: { fr: "Finances", ar: "المالية" },
  nav_group_docs: { fr: "Documents", ar: "الوثائق" },
  nav_group_directory: { fr: "Répertoire", ar: "الدليل" },

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
  import_csv: { fr: "Importer un CSV", ar: "استيراد CSV" },
  download_template: { fr: "Modèle CSV", ar: "نموذج CSV" },
  import_preview: { fr: "Aperçu de l'import", ar: "معاينة الاستيراد" },
  import_hint: {
    fr: "Colonnes du fichier : name, name_fr, category, unit, purchase_price, sale_price, vat_rate, supplier. Seule « name » est obligatoire ; l'ordre est libre. Le fournisseur est rattaché s'il existe déjà (même nom). Les produits déjà présents (même nom) sont ignorés.",
    ar: "أعمدة الملف: name، name_fr، category، unit، purchase_price، sale_price، vat_rate، supplier. « name » وحده إلزامي والترتيب حر. يُربط المورد إن كان موجودا (نفس الاسم). المنتجات الموجودة (نفس الاسم) تُتجاهل.",
  },
  import_bad_header: {
    fr: "En-tête introuvable. Le fichier doit avoir une ligne d'en-tête avec au moins une colonne « name ». Téléchargez le modèle.",
    ar: "لم يُعثر على سطر العناوين. يجب أن يحتوي الملف على سطر عناوين به على الأقل عمود « name ». حمّل النموذج.",
  },
  import_new_count: { fr: "nouveaux produits", ar: "منتجات جديدة" },
  import_dup_skipped: { fr: "déjà présents (ignorés)", ar: "موجودة سابقا (مُتجاهَلة)" },
  import_confirm: { fr: "Importer", ar: "استيراد" },
  importing: { fr: "Import en cours…", ar: "جاري الاستيراد…" },
  import_empty: { fr: "Aucun produit trouvé dans ce fichier.", ar: "لم يُعثر على منتجات في هذا الملف." },
  import_done: { fr: "produits importés ✓", ar: "منتجات مستوردة ✓" },

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

  // Banque — relevés & rapprochement
  bank_title: { fr: "Banque — relevés de compte", ar: "البنك — كشوف الحساب" },
  bank_hint: {
    fr: "Importez le relevé PDF (Attijariwafa) : les encaissements et les paiements fournisseurs sont détectés automatiquement.",
    ar: "استورد كشف الحساب PDF: تُكتشف المداخيل ومدفوعات الموردين تلقائيا.",
  },
  bank_import: { fr: "Importer un relevé PDF", ar: "استيراد كشف PDF" },
  bank_analyzing: { fr: "Analyse du PDF…", ar: "جاري تحليل PDF…" },
  bank_preview: { fr: "Aperçu avant import", ar: "معاينة قبل الاستيراد" },
  bank_confirm_import: { fr: "Importer ces mouvements", ar: "استيراد هذه الحركات" },
  bank_importing: { fr: "Import en cours…", ar: "جاري الاستيراد…" },
  bank_imported: { fr: "Relevé importé ✓", ar: "تم استيراد الكشف ✓" },
  bank_parse_failed: {
    fr: "Impossible de lire ce PDF. Vérifiez que c'est bien le relevé téléchargé depuis l'appli de la banque (pas un scan).",
    ar: "تعذّرت قراءة هذا الـ PDF. تأكد أنه الكشف المُحمّل من تطبيق البنك (وليس صورة ممسوحة).",
  },
  bank_nothing_new: { fr: "Aucun nouveau mouvement (déjà importé).", ar: "لا حركات جديدة (مستوردة سابقا)." },
  bank_dup_skipped: { fr: "déjà présents, ignorés", ar: "موجودة سابقا، تم تجاهلها" },
  bank_opening: { fr: "Solde départ", ar: "رصيد البداية" },
  bank_closing: { fr: "Solde final", ar: "الرصيد النهائي" },
  bank_total_debit: { fr: "Total débits", ar: "مجموع المدين" },
  bank_total_credit: { fr: "Total crédits", ar: "مجموع الدائن" },
  bank_check_ok: { fr: "Relevé équilibré ✓", ar: "الكشف متوازن ✓" },
  bank_check_warn: { fr: "À vérifier", ar: "للمراجعة" },
  bank_op_date: { fr: "Date op.", ar: "تاريخ العملية" },
  bank_direction: { fr: "Sens", ar: "الاتجاه" },
  bank_kind: { fr: "Catégorie", ar: "التصنيف" },
  bank_debit: { fr: "Débit", ar: "مدين" },
  bank_credit: { fr: "Crédit", ar: "دائن" },
  kind_encaissement: { fr: "Encaissement", ar: "مدخول" },
  kind_paiement_frs: { fr: "Paiement fournisseur", ar: "دفع لمورد" },
  kind_apport: { fr: "Apport / virement", ar: "مساهمة / تحويل" },
  kind_charge: { fr: "Charge", ar: "مصروف" },
  kind_autre: { fr: "Autre", ar: "آخر" },
  bank_statements: { fr: "Relevés importés", ar: "الكشوف المستوردة" },
  bank_movements: { fr: "Mouvements", ar: "الحركات" },
  bank_delete_statement: { fr: "Supprimer ce relevé et ses mouvements ?", ar: "حذف هذا الكشف وحركاته؟" },
  bank_filter_all: { fr: "Tous", ar: "الكل" },
  bank_filter_deposits: { fr: "Encaissements", ar: "المداخيل" },
  bank_filter_supplier: { fr: "Paiements fournisseurs", ar: "مدفوعات الموردين" },
  bank_filter_charges: { fr: "Charges", ar: "المصاريف" },
  bank_filter_todo: { fr: "À rapprocher", ar: "للمطابقة" },
  bank_reconcile: { fr: "Rapprocher", ar: "مطابقة" },
  bank_pick_supplier: { fr: "— Fournisseur —", ar: "— المورد —" },
  bank_reconciled: { fr: "Rapproché ✓", ar: "تمت المطابقة ✓" },
  bank_unreconcile: { fr: "Annuler le rapprochement", ar: "إلغاء المطابقة" },
  bank_reconcile_hint: {
    fr: "Associez chaque paiement chèque à son fournisseur : un paiement est créé et la dette du fournisseur est mise à jour.",
    ar: "اربط كل دفعة شيك بموردها: تُنشأ دفعة ويُحدَّث دين المورد.",
  },
  bank_deposits_month: { fr: "Encaissements du mois", ar: "مداخيل الشهر" },
  bank_supplier_pay_month: { fr: "Paiements fournisseurs du mois", ar: "مدفوعات الموردين هذا الشهر" },
  bank_to_reconcile_count: { fr: "à rapprocher", ar: "للمطابقة" },
  bank_manual_add: { fr: "Ajouter un mouvement", ar: "إضافة حركة" },
  bank_no_tx: { fr: "Aucun mouvement. Importez un relevé PDF.", ar: "لا توجد حركات. استورد كشف PDF." },

  // Clients
  clients_title: { fr: "Clients", ar: "الزبناء" },
  clients_hint: {
    fr: "Clients qui reçoivent une facture. Les ventes des autres restent « au comptant ».",
    ar: "الزبناء الذين يتوصلون بفاتورة. مبيعات الباقين تبقى « نقدا ».",
  },
  add_client: { fr: "Ajouter un client", ar: "إضافة زبون" },
  new_client: { fr: "Nouveau client", ar: "زبون جديد" },
  edit_client: { fr: "Modifier le client", ar: "تعديل الزبون" },
  client_name: { fr: "Nom / raison sociale", ar: "الاسم / التسمية التجارية" },
  client_ice: { fr: "ICE", ar: "المعرف الموحد" },
  client_if: { fr: "Identifiant fiscal (IF)", ar: "المعرف الجبائي" },
  client_rc: { fr: "Registre de commerce (RC)", ar: "السجل التجاري" },
  wants_invoice: { fr: "Reçoit une facture", ar: "يتوصل بفاتورة" },
  discount_rate: { fr: "Remise %", ar: "التخفيض %" },
  no_clients: { fr: "Aucun client. Cliquez sur « Ajouter un client ».", ar: "لا يوجد زبناء. اضغط « إضافة زبون »." },
  client_count: { fr: "clients", ar: "زبناء" },
  invoiced_clients: { fr: "avec facture", ar: "بفاتورة" },
  confirm_delete_client: { fr: "Supprimer ce client ?", ar: "حذف هذا الزبون؟" },
  yes_short: { fr: "Oui", ar: "نعم" },
  no_short: { fr: "Non", ar: "لا" },

  // Ventilation des encaissements
  ventilation_title: { fr: "Ventilation des encaissements", ar: "توزيع المداخيل" },
  ventilation_hint: {
    fr: "Répartissez le total encaissé du mois entre les clients facturés ; le reste part « au comptant ».",
    ar: "وزّع مجموع مداخيل الشهر بين الزبناء المفوترين ؛ الباقي يذهب « نقدا ».",
  },
  vt_encaissement: { fr: "Total encaissé", ar: "مجموع المداخيل" },
  vt_pool: { fr: "Ventes du mois (TTC)", ar: "مبيعات الشهر (بالضريبة)" },
  vt_gap: { fr: "Écart encaissé / ventes", ar: "الفرق مداخيل / مبيعات" },
  vt_auto: { fr: "Auto (banque)", ar: "تلقائي (البنك)" },
  vt_manual: { fr: "Saisir manuellement", ar: "إدخال يدوي" },
  vt_from_bank: { fr: "Recalculé depuis les encaissements du relevé.", ar: "يُحتسب من مداخيل الكشف." },
  vt_no_bank: {
    fr: "Aucun encaissement bancaire pour ce mois — importez le relevé (page Banque) ou saisissez le total manuellement.",
    ar: "لا مداخيل بنكية لهذا الشهر — استورد الكشف (صفحة البنك) أو أدخل المجموع يدويا.",
  },
  vt_pool_table: { fr: "Produits vendus ce mois (base des factures)", ar: "المنتجات المباعة هذا الشهر (أساس الفواتير)" },
  vt_qty_sold: { fr: "Qté vendue", ar: "الكمية المباعة" },
  vt_pu: { fr: "PU moyen", ar: "الثمن المتوسط" },
  vt_line_ttc: { fr: "Total TTC", ar: "المجموع بالضريبة" },
  vt_targets: { fr: "Montant à facturer par client", ar: "المبلغ للفوترة لكل زبون" },
  vt_target_ttc: { fr: "À facturer (TTC)", ar: "للفوترة (بالضريبة)" },
  vt_no_invoice_clients: {
    fr: "Aucun client « reçoit une facture ». Ajoutez-en dans la page Clients.",
    ar: "لا زبون « يتوصل بفاتورة ». أضف زبناء في صفحة الزبناء.",
  },
  vt_total_invoiced: { fr: "Total facturé", ar: "مجموع المفوتر" },
  vt_comptant: { fr: "Au comptant (reste)", ar: "نقدا (الباقي)" },
  vt_over: { fr: "Le total facturé dépasse le total encaissé.", ar: "المجموع المفوتر يتجاوز المداخيل." },
  vt_saved: { fr: "Ventilation enregistrée ✓", ar: "تم حفظ التوزيع ✓" },
  vt_fill_pool: { fr: "Remplir depuis les ventes", ar: "ملء من المبيعات" },
  vt_no_sales: { fr: "Aucune vente enregistrée ce mois.", ar: "لا مبيعات مسجلة هذا الشهر." },
  vt_next_step: { fr: "Étape suivante : page Factures pour générer les documents.", ar: "الخطوة التالية: صفحة الفواتير لتوليد الوثائق." },

  // Factures de vente
  invoices_title: { fr: "Factures de vente", ar: "فواتير البيع" },
  invoices_hint: {
    fr: "Génère les factures du mois à partir de la ventilation, en puisant dans les quantités réellement vendues.",
    ar: "تولّد فواتير الشهر انطلاقا من التوزيع، مع السحب من الكميات المباعة فعليا.",
  },
  inv_need_ventilation: {
    fr: "Renseignez d'abord la ventilation de ce mois (page Ventilation).",
    ar: "أدخل أولا توزيع هذا الشهر (صفحة التوزيع).",
  },
  inv_generate: { fr: "Générer les brouillons", ar: "توليد المسودات" },
  inv_regenerate: { fr: "Regénérer", ar: "إعادة التوليد" },
  inv_generating: { fr: "Génération…", ar: "جاري التوليد…" },
  inv_confirm_regen: {
    fr: "Regénérer remplacera toutes les factures (brouillons et finalisées) de ce mois. Continuer ?",
    ar: "إعادة التوليد ستستبدل كل فواتير هذا الشهر (مسودات ونهائية). متابعة؟",
  },
  inv_none: { fr: "Aucune facture générée pour ce mois.", ar: "لا فواتير مولّدة لهذا الشهر." },
  inv_number: { fr: "N°", ar: "رقم" },
  inv_client: { fr: "Client", ar: "الزبون" },
  inv_target: { fr: "Objectif", ar: "الهدف" },
  inv_realized: { fr: "Facturé", ar: "المفوتر" },
  inv_gap: { fr: "Écart", ar: "الفرق" },
  inv_status_draft: { fr: "Brouillon", ar: "مسودة" },
  inv_status_final: { fr: "Finalisée", ar: "نهائية" },
  inv_view: { fr: "Voir / PDF", ar: "عرض / PDF" },
  inv_edit_lines: { fr: "Lignes", ar: "الأسطر" },
  inv_finalize: { fr: "Finaliser (n°)", ar: "إنهاء (رقم)" },
  inv_finalize_all: { fr: "Finaliser tout", ar: "إنهاء الكل" },
  inv_confirm_finalize: {
    fr: "Attribuer les numéros définitifs aux brouillons de ce mois ?",
    ar: "إسناد الأرقام النهائية لمسودات هذا الشهر؟",
  },
  inv_delete: { fr: "Supprimer cette facture ?", ar: "حذف هذه الفاتورة؟" },
  inv_start_number: { fr: "Premier n° de facture", ar: "أول رقم فاتورة" },
  inv_comptant: { fr: "Au comptant (non facturé)", ar: "نقدا (غير مفوتر)" },
  inv_control: { fr: "Contrôle mensuel — quantités", ar: "المراقبة الشهرية — الكميات" },
  inv_col_pool: { fr: "Vendu", ar: "المباع" },
  inv_col_invoiced: { fr: "Facturé", ar: "المفوتر" },
  inv_col_comptant: { fr: "Comptant", ar: "نقدا" },
  inv_col_left: { fr: "Non alloué", ar: "غير موزع" },
  inv_totttc: { fr: "Σ factures", ar: "مجموع الفواتير" },
  inv_check_row: { fr: "Σ factures + comptant vs encaissé", ar: "مجموع الفواتير + نقدا مقابل المداخيل" },
  inv_add_line: { fr: "+ Ligne", ar: "+ سطر" },
  inv_pick_product: { fr: "Produit…", ar: "منتج…" },
  inv_available: { fr: "dispo", ar: "متاح" },
  inv_line_over: { fr: "Quantité supérieure au disponible.", ar: "الكمية تفوق المتاح." },
  inv_save_lines: { fr: "Enregistrer les lignes", ar: "حفظ الأسطر" },
  inv_regen_hint: {
    fr: "Les modifications manuelles seront perdues si vous regénérez.",
    ar: "ستضيع التعديلات اليدوية إذا أعدت التوليد.",
  },

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
