"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { DemandModel } from "@/lib/demandForecast";
import { loadDemandState, toInputs, type DemandState } from "@/lib/demandData";
import ForecastTab from "@/components/demand/ForecastTab";
import SeasonsTab from "@/components/demand/SeasonsTab";
import HistoryTab from "@/components/demand/HistoryTab";

type Tab = "forecast" | "seasons" | "history";

export default function PrevisionPage() {
  const { t } = useI18n();
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<DemandState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("forecast");

  const reload = useCallback(
    () =>
      loadDemandState(supabase).then(
        (s) => {
          setState(s);
          setError(null);
        },
        (e) => {
          const msg = (e as { message?: string })?.message ?? String(e);
          setError(/sales_history|demand_/.test(msg) ? t("dm_missing_tables") : msg);
        }
      ),
    [supabase, t]
  );

  useEffect(() => {
    reload();
  }, [reload]);

  // Le modèle est recalculé localement à chaque modification (coefficients, dates…)
  const model = useMemo(() => (state ? new DemandModel(toInputs(state)) : null), [state]);

  const tabs: { key: Tab; label: string }[] = [
    { key: "forecast", label: t("dm_tab_forecast") },
    { key: "seasons", label: t("dm_tab_seasons") },
    { key: "history", label: t("dm_tab_history") },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("dm_title")}</h1>
        <div className="flex rounded-lg border border-border bg-surface p-0.5">
          {tabs.map((x) => (
            <button
              key={x.key}
              onClick={() => setTab(x.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                tab === x.key ? "bg-primary text-primary-fg" : "text-foreground hover:bg-background"
              }`}
            >
              {x.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>
      ) : !state || !model ? (
        <p className="p-8 text-center text-muted">{t("loading")}</p>
      ) : tab === "forecast" ? (
        <ForecastTab state={state} model={model} />
      ) : tab === "seasons" ? (
        <SeasonsTab state={state} model={model} setState={setState} />
      ) : (
        <HistoryTab state={state} setState={setState} reload={reload} />
      )}
    </div>
  );
}
