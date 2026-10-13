import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMailConfig, makeTransport, fromHeader } from "@/lib/mailer";

// nodemailer nécessite le runtime Node.js (pas Edge).
export const runtime = "nodejs";

interface Body {
  to?: string;
  subject?: string;
  text?: string;
  html?: string;
  pdfBase64?: string;
  filename?: string;
}

export async function POST(req: Request) {
  // 1) Authentification : seul un utilisateur connecté peut envoyer.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2) Configuration Gmail présente ? (Paramètres, sinon variables d'environnement)
  const cfg = await getMailConfig(supabase);
  if (!cfg) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  // 3) Validation de la requête.
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const { to, subject, text, html, pdfBase64, filename } = body;
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return NextResponse.json({ error: "invalid_recipient" }, { status: 400 });
  }
  if (!pdfBase64) {
    return NextResponse.json({ error: "missing_pdf" }, { status: 400 });
  }

  // 4) Envoi via SMTP Gmail (mot de passe d'application).
  try {
    await makeTransport(cfg).sendMail({
      from: fromHeader(cfg),
      to,
      subject: subject || "Bon de commande",
      text: text || "Veuillez trouver ci-joint notre bon de commande.",
      html,
      attachments: [
        {
          filename: filename || "bon-de-commande.pdf",
          content: Buffer.from(pdfBase64, "base64"),
          contentType: "application/pdf",
        },
      ],
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("send-bc error:", e);
    return NextResponse.json({ error: "send_failed" }, { status: 502 });
  }
}
