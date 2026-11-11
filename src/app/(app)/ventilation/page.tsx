import { redirect } from "next/navigation";

// La ventilation par client est remplacée par le Dossier comptable mensuel.
export default function VentilationPage() {
  redirect("/dossier-comptable");
}
