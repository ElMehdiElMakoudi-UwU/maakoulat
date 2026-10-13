"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import JSZip from "jszip";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { rowsToCsv, downloadFile } from "@/lib/csv";
import { COMPANY } from "@/lib/company";
import {
  COMPANY_FIELDS,
  companyKey,
  companyFromRows,
  DEFAULT_BC_SUBJECT,
  DEFAULT_BC_BODY,
  type CompanyField,
} from "@/lib/settings";

const BACKUP_TABLES = [
  "sellers",
  "products",
  "sales",
  "inventory_counts",
  "suppliers",
  "supplier_payments",
  "supplier_invoices",
  "charges",
  "clients",
  "purchase_orders",
  "purchase_order_items",
  "sales_invoices",
  "sales_invoice_items",
  "monthly_ventilation",
  "ventilation_targets",
  "monthly_settings",
  "bank_statements",
  "bank_transactions",
  "app_settings",
] as const;

type Row = { key: string; value: string | null };
type SaveState = "idle" | "saving" | "saved" | "error";

interface EmailStatus {
  migrated: boolean;
  passwordSet: boolean;
  passwordUpdatedAt: string | null;
  envConfigured: boolean;
  configured: boolean;
}

// Champs dont le contenu est toujours latin (n°, téléphone, email).
const LTR_FIELDS: CompanyField[] = ["tel", "email", "rc", "patente", "if", "ice"];

export default function ParametresPage() {
  const { t, lang } = useI18n();
  const supabase = useMemo(() => createClient(), []);

  // ---------- Réglages (app_settings) ----------
  const [company, setCompany] = useState<Record<CompanyField, string>>({ ...COMPANY });
  const [gmailUser, setGmailUser] = useState("");
  const [gmailFromName, setGmailFromName] = useState("");
  const [bcSubject, setBcSubject] = useState(DEFAULT_BC_SUBJECT);
  const [bcBody, setBcBody] = useState(DEFAULT_BC_BODY);
  const [invoiceStart, setInvoiceStart] = useState("");
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});

  // ---------- Gmail ----------
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [emailStatus, setEmailStatus] = useState<EmailStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadEmailStatus = useCallback(async () => {
    const res = await fetch("/api/email-config");
    if (res.ok) setEmailStatus((await res.json()) as EmailStatus);
  }, []);

  useEffect(() => {
    supabase
      .from("app_settings")
      .select("key, value")
      .then(({ data }) => {
        const rows = (data as Row[]) ?? [];
        const map = new Map(rows.map((r) => [r.key, r.value ?? ""]));
        const c = companyFromRows(rows);
        setCompany(Object.fromEntries(COMPANY_FIELDS.map((f) => [f, c[f]])) as Record<CompanyField, string>);
        setGmailUser(map.get("gmail_user") ?? "");
        setGmailFromName(map.get("gmail_from_name") ?? "");
        if (map.get("bc_email_subject")) setBcSubject(map.get("bc_email_subject")!);
        if (map.get("bc_email_body")) setBcBody(map.get("bc_email_body")!);
        setInvoiceStart(map.get("invoice_start_number") ?? "");
      });
    fetch("/api/email-config")
      .then((res) => (res.ok ? (res.json() as Promise<EmailStatus>) : null))
      .then((s) => s && setEmailStatus(s));
  }, [supabase]);

  async function upsertSettings(section: string, values: Record<string, string>, extra?: () => Promise<void>) {
    setSaveState((s) => ({ ...s, [section]: "saving" }));
    try {
      const rows = Object.entries(values).map(([key, value]) => ({ key, value: value.trim() }));
      const { error } = await supabase.from("app_settings").upsert(rows, { onConflict: "key" });
      if (error) throw error;
      if (extra) await extra();
      setSaveState((s) => ({ ...s, [section]: "saved" }));
      setTimeout(() => setSaveState((s) => ({ ...s, [section]: "idle" })), 2500);
    } catch {
      setSaveState((s) => ({ ...s, [section]: "error" }));
    }
  }

  function saveCompany() {
    upsertSettings(
      "company",
      Object.fromEntries(COMPANY_FIELDS.map((f) => [companyKey(f), company[f]]))
    );
  }

  function saveEmail() {
    upsertSettings(
      "email",
      { gmail_user: gmailUser, gmail_from_name: gmailFromName },
      async () => {
        if (password.trim()) {
          const { error } = await supabase.rpc("set_app_secret", {
            p_key: "gmail_app_password",
            p_value: password.replace(/\s+/g, ""),
          });
          if (error) throw error;
          setPassword("");
        }
        await loadEmailStatus();
      }
    );
  }

  async function removePassword() {
    if (!confirm(t("gmail_pw_remove_confirm"))) return;
    await supabase.rpc("set_app_secret", { p_key: "gmail_app_password", p_value: "" });
    await loadEmailStatus();
  }

  async function sendTest() {
    setTesting(true);
    setTestMsg(null);
    try {
      const res = await fetch("/api/email-config", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { to?: string; error?: string };
      if (res.ok) setTestMsg({ ok: true, text: `${t("test_email_ok")} ${body.to}` });
      else if (body.error === "not_configured") setTestMsg({ ok: false, text: t("email_not_configured") });
      else if (body.error === "auth_failed") setTestMsg({ ok: false, text: t("test_email_auth_failed") });
      else setTestMsg({ ok: false, text: t("email_error") });
    } catch {
      setTestMsg({ ok: false, text: t("email_error") });
    } finally {
      setTesting(false);
    }
  }

  // ---------- Sauvegarde ----------
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [doneAt, setDoneAt] = useState<number | null>(null);

  async function exportBackup() {
    setExporting(true);
    setError("");
    setDoneAt(null);
    try {
      const zip = new JSZip();
      for (const table of BACKUP_TABLES) {
        setProgress(table);
        const { data, error: qErr } = await supabase.from(table).select("*");
        if (qErr) throw new Error(`${table}: ${qErr.message}`);
        zip.file(`${table}.csv`, rowsToCsv((data as Record<string, unknown>[]) ?? []));
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const date = new Date().toISOString().slice(0, 10);
      downloadFile(`maakoulat-sauvegarde-${date}.zip`, blob);
      setDoneAt(Date.now());
    } catch {
      setError(t("backup_error"));
    } finally {
      setExporting(false);
      setProgress("");
    }
  }

  const statusLine = !emailStatus
    ? null
    : emailStatus.passwordSet && emailStatus.configured
      ? { ok: true, text: t("gmail_status_settings") }
      : emailStatus.envConfigured
        ? { ok: true, text: t("gmail_status_env") }
        : { ok: false, text: t("gmail_status_off") };

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold">{t("settings_title")}</h1>
        <p className="text-sm text-muted">{t("settings_hint")}</p>
      </div>

      <div className="grid max-w-5xl gap-4 lg:grid-cols-2">
        {/* ---------- Envoi des emails (Gmail) ---------- */}
        <Section title={`✉️ ${t("set_email_title")}`} hint={t("set_email_hint")}>
          {statusLine && (
            <p
              className={`mb-3 rounded-lg px-3 py-2 text-sm ${
                statusLine.ok ? "bg-primary/10 text-primary" : "bg-accent/10 text-accent"
              }`}
            >
              {statusLine.text}
            </p>
          )}
          {emailStatus && !emailStatus.migrated && (
            <p className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{t("set_migration_missing")}</p>
          )}

          <Field label={t("gmail_user")}>
            <input
              type="email"
              dir="ltr"
              value={gmailUser}
              placeholder={COMPANY.email}
              onChange={(e) => setGmailUser(e.target.value)}
              className="input w-full"
              autoComplete="off"
            />
          </Field>
          <Field label={t("gmail_from_name")}>
            <input
              value={gmailFromName}
              placeholder="Maakoulatcom Distribution"
              onChange={(e) => setGmailFromName(e.target.value)}
              className="input w-full"
            />
          </Field>
          <Field label={t("gmail_app_password")}>
            <div className="flex gap-2">
              <input
                type={showPw ? "text" : "password"}
                dir="ltr"
                value={password}
                placeholder={emailStatus?.passwordSet ? t("gmail_pw_keep") : t("gmail_pw_new")}
                onChange={(e) => setPassword(e.target.value)}
                className="input w-full font-mono"
                autoComplete="new-password"
                disabled={emailStatus ? !emailStatus.migrated : false}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="shrink-0 rounded-lg border border-border px-3 text-sm"
              >
                {showPw ? t("gmail_hide") : t("gmail_show")}
              </button>
            </div>
            <div className="mt-1 flex items-center justify-between text-xs">
              <span className={emailStatus?.passwordSet ? "text-primary" : "text-muted"}>
                {emailStatus?.passwordSet
                  ? `${t("gmail_pw_set")}${
                      emailStatus.passwordUpdatedAt
                        ? ` — ${new Date(emailStatus.passwordUpdatedAt).toLocaleDateString(lang === "ar" ? "ar-MA" : "fr-FR")}`
                        : ""
                    }`
                  : t("gmail_pw_not_set")}
              </span>
              {emailStatus?.passwordSet && (
                <button type="button" onClick={removePassword} className="text-danger hover:underline">
                  {t("gmail_pw_remove")}
                </button>
              )}
            </div>
          </Field>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <SaveButton state={saveState.email} onClick={saveEmail} t={t} />
            <button
              onClick={sendTest}
              disabled={testing}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium disabled:opacity-60"
            >
              {testing ? t("test_email_sending") : `📨 ${t("test_email_btn")}`}
            </button>
          </div>
          {testMsg && (
            <p
              className={`mt-3 rounded-lg px-3 py-2 text-sm ${
                testMsg.ok ? "bg-primary/10 text-primary" : "bg-danger/10 text-danger"
              }`}
            >
              {testMsg.text}
            </p>
          )}

          <details className="mt-4 rounded-lg border border-border px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium">{t("gmail_help_title")}</summary>
            <ol className="mt-2 list-decimal space-y-1 ps-5 text-muted">
              <li>{t("gmail_help_1")}</li>
              <li>
                <a
                  href="https://myaccount.google.com/apppasswords"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                >
                  {t("gmail_help_2")}
                </a>
              </li>
              <li>{t("gmail_help_3")}</li>
              <li>{t("gmail_help_4")}</li>
            </ol>
          </details>
        </Section>

        {/* ---------- Coordonnées société ---------- */}
        <Section title={`🏢 ${t("set_company_title")}`} hint={t("set_company_hint")}>
          <div className="grid gap-x-3 sm:grid-cols-2">
            {COMPANY_FIELDS.map((f) => (
              <div key={f} className={f === "name" || f === "address" ? "sm:col-span-2" : ""}>
                <Field label={t(`co_${f}`)}>
                  <input
                    value={company[f]}
                    dir={LTR_FIELDS.includes(f) ? "ltr" : undefined}
                    onChange={(e) => setCompany((c) => ({ ...c, [f]: e.target.value }))}
                    className="input w-full"
                  />
                </Field>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <SaveButton state={saveState.company} onClick={saveCompany} t={t} />
            <button
              onClick={() => setCompany({ ...COMPANY })}
              className="rounded-lg border border-border px-4 py-2 text-sm"
            >
              {t("set_reset_default")}
            </button>
          </div>
        </Section>

        {/* ---------- Message d'envoi des BC ---------- */}
        <Section title={`📝 ${t("set_bc_tpl_title")}`} hint={t("set_bc_tpl_hint")}>
          <Field label={t("bc_tpl_subject")}>
            <input value={bcSubject} onChange={(e) => setBcSubject(e.target.value)} className="input w-full" />
          </Field>
          <Field label={t("bc_tpl_body")}>
            <textarea
              value={bcBody}
              rows={7}
              onChange={(e) => setBcBody(e.target.value)}
              className="input w-full"
            />
          </Field>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <SaveButton
              state={saveState.bctpl}
              onClick={() => upsertSettings("bctpl", { bc_email_subject: bcSubject, bc_email_body: bcBody })}
              t={t}
            />
            <button
              onClick={() => {
                setBcSubject(DEFAULT_BC_SUBJECT);
                setBcBody(DEFAULT_BC_BODY);
              }}
              className="rounded-lg border border-border px-4 py-2 text-sm"
            >
              {t("set_reset_default")}
            </button>
          </div>
        </Section>

        <div className="flex flex-col gap-4">
          {/* ---------- Numérotation des factures ---------- */}
          <Section title={`🧾 ${t("set_invoice_title")}`} hint={t("set_invoice_hint")}>
            <div className="flex flex-wrap items-end gap-2">
              <input
                type="number"
                min={1}
                dir="ltr"
                value={invoiceStart}
                onChange={(e) => setInvoiceStart(e.target.value)}
                className="input w-32"
              />
              <SaveButton
                state={saveState.invoice}
                onClick={() => upsertSettings("invoice", { invoice_start_number: invoiceStart })}
                t={t}
                disabled={!(parseInt(invoiceStart, 10) >= 1)}
              />
            </div>
          </Section>

          {/* ---------- Sauvegarde ---------- */}
          <Section title={`💾 ${t("backup_title")}`} hint={t("backup_hint")}>
            <button
              onClick={exportBackup}
              disabled={exporting}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg hover:opacity-90 disabled:opacity-60"
            >
              {exporting ? `${t("backup_exporting")} (${progress})` : `⬇️ ${t("backup_export_btn")}`}
            </button>

            {doneAt && (
              <p className="mt-3 rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">{t("backup_done")}</p>
            )}
            {error && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
            <p className="mt-3 text-xs text-muted" dir={lang === "ar" ? "rtl" : "ltr"}>
              {t("backup_tables_hint")}
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="font-bold">{title}</h2>
      <p className="mb-4 mt-1 text-sm text-muted">{hint}</p>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

function SaveButton({
  state = "idle",
  onClick,
  t,
  disabled,
}: {
  state?: SaveState;
  onClick: () => void;
  t: (k: string) => string;
  disabled?: boolean;
}) {
  return (
    <>
      <button
        onClick={onClick}
        disabled={disabled || state === "saving"}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg hover:opacity-90 disabled:opacity-60"
      >
        {state === "saving" ? t("set_saving") : t("set_save")}
      </button>
      {state === "saved" && <span className="text-sm text-primary">{t("set_saved")}</span>}
      {state === "error" && <span className="text-sm text-danger">{t("set_save_error")}</span>}
    </>
  );
}
