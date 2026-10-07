"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import LangToggle from "@/components/LangToggle";

const NAV_GROUPS = [
  {
    key: "nav_group_main",
    items: [
      { href: "/", key: "nav_dashboard", icon: "📊" },
      { href: "/ventes", key: "nav_sales", icon: "🧾" },
      { href: "/journal", key: "nav_history", icon: "📖" },
      { href: "/analyse", key: "nav_analysis", icon: "📈" },
      { href: "/analyse-produits", key: "nav_product_analysis", icon: "🔬" },
      { href: "/prevision", key: "nav_forecast", icon: "🔮" },
      { href: "/rapports", key: "nav_reports", icon: "📄" },
    ],
  },
  {
    key: "nav_group_finance",
    items: [
      { href: "/tresorerie", key: "nav_treasury", icon: "💰" },
      { href: "/banque", key: "nav_bank", icon: "🏦" },
      { href: "/charges", key: "nav_charges", icon: "💸" },
      { href: "/ventilation", key: "nav_ventilation", icon: "🧮" },
    ],
  },
  {
    key: "nav_group_docs",
    items: [
      { href: "/factures", key: "nav_invoices", icon: "📑" },
      { href: "/bons-commande", key: "nav_orders", icon: "📝" },
    ],
  },
  {
    key: "nav_group_directory",
    items: [
      { href: "/produits", key: "nav_products", icon: "📦" },
      { href: "/fournisseurs", key: "nav_suppliers", icon: "🚚" },
      { href: "/clients", key: "nav_clients", icon: "👥" },
    ],
  },
  {
    key: "nav_group_settings",
    items: [{ href: "/parametres", key: "nav_settings", icon: "⚙️" }],
  },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Ferme le menu mobile quand la page change (évite d'annuler la navigation
  // en démontant le lien pendant le clic).
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.refresh();
    router.push("/login");
  }

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  return (
    <div className="flex min-h-screen">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-e border-border bg-surface p-4 md:flex">
        <Brand />
        <nav className="mt-6 flex flex-1 flex-col gap-4 overflow-y-auto">
          {NAV_GROUPS.map((group) => (
            <div key={group.key} className="flex flex-col gap-1">
              <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                {t(group.key)}
              </div>
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    isActive(item.href)
                      ? "bg-primary text-primary-fg"
                      : "text-foreground hover:bg-background"
                  }`}
                >
                  <span>{item.icon}</span>
                  {t(item.key)}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-4">
          <LangToggle />
          <button
            onClick={logout}
            className="rounded-lg px-3 py-2 text-sm text-danger hover:bg-background"
          >
            {t("logout")}
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar (mobile) */}
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-surface px-4 py-3 md:hidden">
          <Brand small />
          <div className="flex items-center gap-2">
            <LangToggle />
            <button
              onClick={() => setMobileOpen((o) => !o)}
              className="rounded-lg border border-border px-3 py-1.5 text-sm"
            >
              ☰
            </button>
          </div>
        </header>

        {mobileOpen && (
          <nav className="grid grid-cols-2 gap-2 border-b border-border bg-surface p-3 md:hidden">
            {NAV_GROUPS.map((group) => (
              <div key={group.key} className="contents">
                <div className="col-span-2 px-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {t(group.key)}
                </div>
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium ${
                      isActive(item.href) ? "bg-primary text-primary-fg" : "bg-background"
                    }`}
                  >
                    <span>{item.icon}</span>
                    {t(item.key)}
                  </Link>
                ))}
              </div>
            ))}
            <button
              onClick={logout}
              className="col-span-2 rounded-lg px-3 py-2.5 text-sm text-danger"
            >
              {t("logout")}
            </button>
          </nav>
        )}

        <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

function Brand({ small = false }: { small?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2.5">
      <div
        className={`flex items-center justify-center rounded-xl bg-primary font-bold text-primary-fg ${
          small ? "h-8 w-8 text-base" : "h-10 w-10 text-lg"
        }`}
      >
        M
      </div>
      <div className="leading-tight">
        <div className="font-bold">{t("appName")}</div>
        {!small && <div className="text-xs text-muted">{t("tagline")}</div>}
      </div>
    </div>
  );
}
