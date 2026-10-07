"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import LangToggle from "@/components/LangToggle";
import { COMPANY } from "@/lib/company";

export default function LoginPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(t("login_error"));
      setLoading(false);
      return;
    }
    router.refresh();
    router.push("/");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="absolute end-4 top-4">
        <LangToggle />
      </div>
      <div className="card w-full max-w-sm p-7 shadow-sm">
        <div className="mb-6 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={COMPANY.logoPath}
            alt={t("appName")}
            className="mx-auto mb-3 h-28 w-auto rounded-xl bg-white object-contain"
          />
          <h1 className="text-xl font-bold">{t("appName")}</h1>
          <p className="text-sm text-muted">{t("tagline")}</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">{t("email")}</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 outline-none focus:border-primary"
              autoComplete="email"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">{t("password")}</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 outline-none focus:border-primary"
              autoComplete="current-password"
            />
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-primary py-2.5 font-semibold text-primary-fg transition hover:opacity-90 disabled:opacity-60"
          >
            {loading ? t("signing_in") : t("signin")}
          </button>
        </form>
      </div>
    </div>
  );
}
