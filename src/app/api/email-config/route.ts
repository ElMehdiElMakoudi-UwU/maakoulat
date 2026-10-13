import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMailConfig, makeTransport, fromHeader } from "@/lib/mailer";

// nodemailer nécessite le runtime Node.js (pas Edge).
export const runtime = "nodejs";

async function authed() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user ? supabase : null;
}

/** État de la configuration Gmail (sans jamais renvoyer le mot de passe). */
export async function GET() {
  const supabase = await authed();
  if (!supabase) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const status = await supabase.rpc("app_secret_status", { p_key: "gmail_app_password" });
  const row = (status.data as { is_set: boolean; updated_at: string | null }[] | null)?.[0];
  const cfg = await getMailConfig(supabase);

  return NextResponse.json({
    migrated: !status.error,
    passwordSet: !!row?.is_set,
    passwordUpdatedAt: row?.updated_at ?? null,
    envConfigured: !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD),
    configured: !!cfg,
  });
}

/** Envoie un email de test à l'adresse Gmail configurée. */
export async function POST() {
  const supabase = await authed();
  if (!supabase) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const cfg = await getMailConfig(supabase);
  if (!cfg) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  try {
    await makeTransport(cfg).sendMail({
      from: fromHeader(cfg),
      to: cfg.user,
      subject: "Test — Maakoulat",
      text: "Cet email confirme que l'envoi des bons de commande depuis Maakoulat fonctionne.",
    });
    return NextResponse.json({ ok: true, to: cfg.user });
  } catch (e) {
    console.error("email-config test error:", e);
    // EAUTH = adresse ou mot de passe d'application refusé par Google.
    const code = (e as { code?: string }).code;
    return NextResponse.json({ error: code === "EAUTH" ? "auth_failed" : "send_failed" }, { status: 502 });
  }
}
