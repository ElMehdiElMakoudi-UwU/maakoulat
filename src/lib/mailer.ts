import nodemailer from "nodemailer";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface MailConfig {
  user: string;
  pass: string;
  fromName: string;
}

/** Configuration Gmail : valeurs saisies dans Paramètres, sinon variables d'environnement. */
export async function getMailConfig(supabase: SupabaseClient): Promise<MailConfig | null> {
  const [{ data: rows }, { data: secret }] = await Promise.all([
    supabase.from("app_settings").select("key, value").in("key", ["gmail_user", "gmail_from_name"]),
    // Échoue silencieusement si la migration n'a pas encore été appliquée.
    supabase.rpc("get_app_secret", { p_key: "gmail_app_password" }),
  ]);
  const map = new Map(((rows as { key: string; value: string | null }[]) ?? []).map((r) => [r.key, r.value?.trim()]));

  const user = map.get("gmail_user") || process.env.GMAIL_USER;
  // Google affiche le mot de passe d'application par groupes de 4 : on retire les espaces.
  const pass = ((secret as string | null) || process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
  if (!user || !pass) return null;
  return {
    user,
    pass,
    fromName: map.get("gmail_from_name") || process.env.GMAIL_FROM_NAME || "Maakoulatcom Distribution",
  };
}

export function makeTransport(cfg: MailConfig) {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: cfg.user, pass: cfg.pass },
  });
}

export function fromHeader(cfg: MailConfig) {
  return `"${cfg.fromName.replace(/"/g, "")}" <${cfg.user}>`;
}
