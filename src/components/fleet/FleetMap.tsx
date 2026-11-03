"use client";

import { useEffect, useRef } from "react";
import type { Map as LMap, LayerGroup } from "leaflet";
import "leaflet/dist/leaflet.css";

export interface MapPoint {
  lat: number;
  lng: number;
  label: string;
  kind: "depot" | "stop";
}

/**
 * Carte OpenStreetMap (Leaflet) : dépôt, arrêts numérotés et tracé de l'itinéraire.
 * Un clic sur la carte appelle onMapClick (ajout d'un arrêt).
 * Leaflet touche `window` : il est importé dynamiquement, côté navigateur uniquement.
 */
export default function FleetMap({
  points,
  route,
  onMapClick,
  className = "",
}: {
  points: MapPoint[];
  route: [number, number][] | null;
  onMapClick?: (lat: number, lng: number) => void;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const clickRef = useRef(onMapClick);
  const dataRef = useRef({ points, route });
  useEffect(() => {
    clickRef.current = onMapClick;
    dataRef.current = { points, route };
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !el.current || map.current) return;
      const m = L.map(el.current, { zoomControl: true }).setView([35.4, -5.7], 9);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: "&copy; OpenStreetMap",
      }).addTo(m);
      m.on("click", (e) => clickRef.current?.(e.latlng.lat, e.latlng.lng));
      map.current = m;
      layer.current = L.layerGroup().addTo(m);
      draw(L, m, layer.current, dataRef.current.points, dataRef.current.route);
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    if (!map.current) return;
    import("leaflet").then((mod) => draw(mod.default, map.current, layer.current, points, route));
  }, [points, route]);

  return <div ref={el} className={`z-0 overflow-hidden rounded-xl border border-border ${className}`} />;
}

function draw(L: typeof import("leaflet"), m: LMap | null, g: LayerGroup | null, points: MapPoint[], route: [number, number][] | null) {
  if (!m || !g) return;
  g.clearLayers();
  let n = 0;
  for (const p of points) {
    const isDepot = p.kind === "depot";
    const html = isDepot
      ? `<div style="background:#0d7a5f;color:#fff;border:2px solid #fff;border-radius:6px;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 1px 4px #0006">🏠</div>`
      : `<div style="background:#f59e0b;color:#111;border:2px solid #fff;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font:700 12px sans-serif;box-shadow:0 1px 4px #0006">${++n}</div>`;
    L.marker([p.lat, p.lng], {
      icon: L.divIcon({ html, className: "", iconSize: [26, 26], iconAnchor: [13, 13] }),
    })
      .bindTooltip(p.label)
      .addTo(g);
  }
  if (route && route.length > 1) {
    L.polyline(route, { color: "#0d7a5f", weight: 5, opacity: 0.85 }).addTo(g);
    m.fitBounds(L.latLngBounds(route), { padding: [30, 30] });
  } else if (points.length > 1) {
    m.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])), { padding: [40, 40] });
  }
}

