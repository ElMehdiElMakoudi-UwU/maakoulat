"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { COMPANY } from "@/lib/company";

/** Coordonnées société modifiables (Paramètres). Valeurs par défaut : lib/company.ts. */
export type Company = typeof COMPANY;
export const COMPANY_FIELDS = ["name", "address", "tel", "email", "rc", "patente", "if", "ice"] as const;
export type CompanyField = (typeof COMPANY_FIELDS)[number];

/** Modèle du message envoyé avec le BC. Variables : {numero} {date} {fournisseur} {societe} {tel}. */
export const DEFAULT_BC_SUBJECT = "Bon de commande{numero} — {societe}";
export const DEFAULT_BC_BODY =
  "Bonjour,\n\nVeuillez trouver ci-joint notre bon de commande{numero} du {date}.\n\nCordialement,\n{societe}\nTél : {tel}";

export const companyKey = (f: CompanyField) => `company_${f}`;

type Row = { key: string; value: string | null };

/** Fusionne les lignes app_settings sur les coordonnées par défaut. */
export function companyFromRows(rows: Row[]): Company {
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const c = { ...COMPANY };
  for (const f of COMPANY_FIELDS) {
    const v = map.get(companyKey(f));
    if (v && v.trim()) c[f] = v;
  }
  return c;
}

/** Remplace les variables {xxx} du modèle d'email. */
export function fillTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

/** Charge les coordonnées société (défauts affichés immédiatement, puis valeurs enregistrées). */
export function useCompany(): Company {
  const supabase = useMemo(() => createClient(), []);
  const [company, setCompany] = useState<Company>(COMPANY);
  useEffect(() => {
    supabase
      .from("app_settings")
      .select("key, value")
      .like("key", "company_%")
      .then(({ data }) => {
        if (data) setCompany(companyFromRows(data as Row[]));
      });
  }, [supabase]);
  return company;
}
