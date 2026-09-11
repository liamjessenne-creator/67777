/**
 * Carte interactive — configuration de référence identique au snippet fourni :
 * Leaflet + tuiles OpenStreetMap, vue de départ Paris (48.8566, 2.3522) zoom 13.
 * Les établissements sont dessinés en cercles colorés natifs (très légers,
 * même avec des milliers de résultats) : rouge = priorité haute,
 * jaune = moyenne, vert = présence numérique forte (disqualifié).
 */

import L from "leaflet";
import { useEffect, useRef } from "react";
import type { Lead } from "./types";
import { VENUE_TYPE_LABELS } from "./types";

interface Props {
  leads: Lead[];
  selectedId: string | null;
  onSelect: (lead: Lead) => void;
  /** Increment to trigger a fitBounds over current markers. */
  fitToken: number;
}

const PRIORITY_COLOR: Record<string, string> = {
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#10b981",
};

export function MapView({ leads, selectedId, onSelect, fitToken }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Init map once (même setup que la référence : Paris, zoom 13)
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [48.8566, 2.3522],
      zoom: 13,
      zoomControl: true,
      attributionControl: true,
    });

    // Fond OSM (comme le snippet), avec secours automatiques si le serveur est bloqué
    const TILE_PROVIDERS: Array<{ url: string; attribution: string; subdomains?: string }> = [
      {
        url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        attribution: "&copy; OpenStreetMap contributors",
      },
      {
        url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
        attribution: "&copy; OpenStreetMap &copy; CARTO",
        subdomains: "abcd",
      },
      {
        url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
        attribution: "&copy; OpenStreetMap, SRTM | OpenTopoMap",
        subdomains: "abc",
      },
    ];
    let providerIdx = 0;
    let tileErrors = 0;
    let tileLayer: L.TileLayer | null = null;
    const addTiles = () => {
      const p = TILE_PROVIDERS[providerIdx];
      tileLayer = L.tileLayer(p.url, {
        attribution: p.attribution,
        ...(p.subdomains ? { subdomains: p.subdomains } : {}),
        maxZoom: 19,
      }).addTo(map);
      tileLayer.on("tileerror", () => {
        tileErrors++;
        if (tileErrors >= 8 && providerIdx < TILE_PROVIDERS.length - 1) {
          tileErrors = 0;
          providerIdx++;
          map.removeLayer(tileLayer!);
          addTiles();
        }
      });
    };
    addTiles();

    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    // Recalcule la taille si la carte est créée masquée ou redimensionnée
    const sizeTimer = setTimeout(() => map.invalidateSize(), 150);
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => map.invalidateSize());
    });
    if (containerRef.current) ro.observe(containerRef.current);
    return () => {
      clearTimeout(sizeTimer);
      cancelAnimationFrame(raf);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // Sync markers with leads (cercles natifs, pas de DOM lourd)
  useEffect(() => {
    const layer = layerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;

    layer.clearLayers();
    for (const lead of leads) {
      const isSelected = lead.id === selectedId;
      const circle = L.circleMarker([lead.venue.lat, lead.venue.lon], {
        radius: isSelected ? 9 : 7,
        color: "#0b0f14",
        weight: isSelected ? 2.5 : 1.5,
        fillColor: PRIORITY_COLOR[lead.enrichment.priority],
        fillOpacity: 0.95,
      });
      circle.bindPopup(
        `<b>${escapeHtml(lead.venue.name)}</b><br/>` +
          `${VENUE_TYPE_LABELS[lead.venue.venueType]}<br/>` +
          `Digital score: <b>${lead.enrichment.digitalScore}/100</b> — ${lead.enrichment.priority}<br/>` +
          `${escapeHtml(lead.venue.address)}`,
      );
      circle.on("click", () => onSelectRef.current(lead));
      circle.addTo(layer);
    }
  }, [leads, selectedId]);

  // Fit aux résultats après chaque scan
  useEffect(() => {
    const map = mapRef.current;
    if (!map || leads.length === 0) return;
    const bounds = L.latLngBounds(leads.map((l) => [l.venue.lat, l.venue.lon] as [number, number]));
    map.fitBounds(bounds.pad(0.12), { animate: true, maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitToken]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {leads.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 z-[400] flex items-center justify-center">
          <div className="rounded-lg border border-surface-border bg-surface-raised/90 px-4 py-3 text-center text-xs text-slate-400 backdrop-blur">
            Search a city and hit <span className="font-semibold text-accent">Analyze Area</span>
            <br />
            to plot venues on the map.
          </div>
        </div>
      ) : null}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}