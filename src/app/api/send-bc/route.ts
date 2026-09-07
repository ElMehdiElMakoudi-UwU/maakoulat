import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { createClient } from "@/lib/supabase/server";

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

  // 2) Configuration Gmail présente ?
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPass) {
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
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: gmailPass },
    });

    await transporter.sendMail({
      from: `"${process.env.GMAIL_FROM_NAME || "Maakoulatcom Distribution"}" <${gmailUser}>`,
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
