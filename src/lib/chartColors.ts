// Palette catégorielle validée (data-viz skill) — ordre fixe, CVD-safe.
// On n'utilise que les 3 premiers slots (validés "all-pairs").
export const SERIES = {
  ca: "#2a78d6", // bleu — Chiffre d'affaires
  profit: "#1baf7a", // aqua — Bénéfice
  third: "#eb6834", // orange — 3e série éventuelle
};

// Couleurs par vendeur (assignées dans l'ordre fixe, jamais recyclées)
export const SELLER_HUES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"];

// Statut (réservé — jamais réutilisé comme série)
export const STATUS = {
  good: "#008300",
  warning: "#eda100",
  critical: "#e34948",
};

// Variables CSS (globals.css) : suivent automatiquement le thème clair/sombre.
export const INK = {
  primary: "var(--ink-primary)",
  secondary: "var(--ink-secondary)",
  muted: "var(--ink-muted)",
  grid: "var(--ink-grid)",
  surface: "var(--surface)",
};
