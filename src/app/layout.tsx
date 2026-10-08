import type { Metadata } from "next";
import { Cairo } from "next/font/google";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["latin", "arabic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Maakoulatcom — Gestion",
  description: "Suivi des ventes, fournisseurs et charges",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" dir="ltr" className={`${cairo.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
