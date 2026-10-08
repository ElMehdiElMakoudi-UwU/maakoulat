export type Theme = "light" | "dark";

// Script exécuté avant l'affichage (layout.tsx) : applique le thème enregistré,
// sinon celui du système, pour éviter un flash clair au chargement.
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.classList.toggle("dark",t==="dark")}catch(e){}})()`;
