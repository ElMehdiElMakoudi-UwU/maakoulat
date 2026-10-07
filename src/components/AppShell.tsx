"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import LangToggle from "@/components/LangToggle";
import { COMPANY } from "@/lib/company";

type NavItem = { href: string; key: string; icon: string };
type NavGroup = { key: string; icon: string; items: NavItem[] };

// Liens directs (les plus utilisés), toujours visibles
const NAV_TOP: NavItem[] = [
  { href: "/", key: "nav_dashboard", icon: "📊" },
  { href: "/ventes", key: "nav_sales", icon: "🧾" },
];

// Sous-menus repliables
const NAV_GROUPS: NavGroup[] = [
  {
    key: "nav_group_analysis",
    icon: "📈",
    items: [
      { href: "/journal", key: "nav_history", icon: "📖" },
      { href: "/analyse", key: "nav_analysis", icon: "📈" },
      { href: "/analyse-produits", key: "nav_product_analysis", icon: "🔬" },
      { href: "/prevision", key: "nav_forecast", icon: "🔮" },
      { href: "/rapports", key: "nav_reports", icon: "📄" },
    ],
  },
  {
    key: "nav_group_finance",
    icon: "💰",
    items: [
      { href: "/tresorerie", key: "nav_treasury", icon: "💰" },
      { href: "/banque", key: "nav_bank", icon: "🏦" },
      { href: "/charges", key: "nav_charges", icon: "💸" },
      { href: "/ventilation", key: "nav_ventilation", icon: "🧮" },
    ],
  },
  {
    key: "nav_group_docs",
    icon: "📑",
    items: [
      { href: "/factures", key: "nav_invoices", icon: "📑" },
      { href: "/bons-commande", key: "nav_orders", icon: "📝" },
    ],
  },
  {
    key: "nav_group_directory",
    icon: "🗂️",
    items: [
      { href: "/produits", key: "nav_products", icon: "📦" },
      { href: "/fournisseurs", key: "nav_suppliers", icon: "🚚" },
      { href: "/clients", key: "nav_clients", icon: "👥" },
    ],
  },
];

const SETTINGS_ITEM: NavItem = { href: "/parametres", key: "nav_settings", icon: "⚙️" };

function isActivePath(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

function activeGroupKey(pathname: string) {
  return NAV_GROUPS.find((g) => g.items.some((i) => isActivePath(pathname, i.href)))?.key ?? null;
}

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

  return (
    <div className="flex min-h-screen">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-e border-border bg-surface p-4 md:flex">
        <Brand />
        <NavTree pathname={pathname} className="mt-6 flex-1 overflow-y-auto" />
        <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
          <NavLink item={SETTINGS_ITEM} active={isActivePath(pathname, SETTINGS_ITEM.href)} />
          <div className="flex items-center justify-between gap-2">
            <LangToggle />
            <button
              onClick={logout}
              className="rounded-lg px-3 py-2 text-sm text-danger hover:bg-background"
            >
              {t("logout")}
            </button>
          </div>
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
              aria-expanded={mobileOpen}
              className="rounded-lg border border-border px-3 py-1.5 text-sm"
            >
              {mobileOpen ? "✕" : "☰"}
            </button>
          </div>
        </header>

        {mobileOpen && (
          <div className="border-b border-border bg-surface p-3 md:hidden">
            <NavTree pathname={pathname} />
            <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
              <NavLink item={SETTINGS_ITEM} active={isActivePath(pathname, SETTINGS_ITEM.href)} />
              <button
                onClick={logout}
                className="rounded-lg px-3 py-2 text-start text-sm text-danger hover:bg-background"
              >
                {t("logout")}
              </button>
            </div>
          </div>
        )}

        <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

function NavTree({ pathname, className = "" }: { pathname: string; className?: string }) {
  const { t } = useI18n();
  // Un seul sous-menu ouvert à la fois ; celui de la page courante s'ouvre automatiquement.
  const [openKey, setOpenKey] = useState<string | null>(() => activeGroupKey(pathname));

  useEffect(() => {
    const key = activeGroupKey(pathname);
    if (key) setOpenKey(key);
  }, [pathname]);

  return (
    <nav className={`flex flex-col gap-1 ${className}`}>
      {NAV_TOP.map((item) => (
        <NavLink key={item.href} item={item} active={isActivePath(pathname, item.href)} />
      ))}

      <div className="my-2 border-t border-border" />

      {NAV_GROUPS.map((group) => {
        const open = openKey === group.key;
        const hasActive = group.items.some((i) => isActivePath(pathname, i.href));
        return (
          <div key={group.key} className="flex flex-col">
            <button
              type="button"
              onClick={() => setOpenKey(open ? null : group.key)}
              aria-expanded={open}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-start text-sm font-medium transition hover:bg-background ${
                hasActive && !open ? "text-primary" : "text-foreground"
              }`}
            >
              <span>{group.icon}</span>
              <span className="flex-1">{t(group.key)}</span>
              <span
                className={`text-muted transition-transform ${open ? "rotate-90" : "rtl:rotate-180"}`}
              >
                ›
              </span>
            </button>
            {open && (
              <div className="mb-1 ms-5 mt-0.5 flex flex-col gap-0.5 border-s border-border ps-2">
                {group.items.map((item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    active={isActivePath(pathname, item.href)}
                    compact
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function NavLink({
  item,
  active,
  compact = false,
}: {
  item: NavItem;
  active: boolean;
  compact?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 rounded-lg px-3 text-sm font-medium transition ${
        compact ? "py-1.5" : "py-2"
      } ${active ? "bg-primary text-primary-fg" : "text-foreground hover:bg-background"}`}
    >
      <span>{item.icon}</span>
      {t(item.key)}
    </Link>
  );
}

function Brand({ small = false }: { small?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={COMPANY.logoPath}
        alt={t("appName")}
        className={`shrink-0 rounded-lg bg-white object-contain ${small ? "h-9 w-12" : "h-11 w-14"}`}
      />
      <div className="leading-tight">
        <div className="font-bold">{t("appName")}</div>
        {!small && <div className="text-xs text-muted">{t("tagline")}</div>}
      </div>
    </div>
  );
}
