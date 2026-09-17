/** Scan filters: venue types, priority and digital-footprint thresholds. */

import type { DigitalFilters, VenueType, VenueTypeFilter } from "./types";
import { VENUE_TYPE_LABELS } from "./types";
import { Button } from "./ui";

const TYPE_ORDER: VenueType[] = ["restaurant", "fast_food", "cafe", "bakery", "bar", "pub"];

interface Props {
  venueTypes: VenueTypeFilter;
  digital: DigitalFilters;
  onVenueTypes: (v: VenueTypeFilter) => void;
  onDigital: (d: DigitalFilters) => void;
  disabled?: boolean;
}

export function FiltersPanel({ venueTypes, digital, onVenueTypes, onDigital, disabled }: Props) {
  const toggleType = (t: VenueType) => {
    onVenueTypes({ ...venueTypes, [t]: !venueTypes[t] });
  };

  const setAll = (value: boolean) => {
    const next = { ...venueTypes };
    for (const t of TYPE_ORDER) next[t] = value;
    onVenueTypes(next);
  };

  return (
    <div className={`space-y-4 ${disabled ? "pointer-events-none opacity-50" : ""}`}>
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-chrome font-mono text-[10px] font-semibold uppercase tracking-[0.2em]">
            Types de commerce
          </span>
          <div className="flex items-center gap-1">
            <Button size="xs" variant="ghost" onClick={() => setAll(true)}>
              tous
            </Button>
            <span className="text-[10px] text-slate-700">/</span>
            <Button size="xs" variant="ghost" onClick={() => setAll(false)}>
              aucun
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {TYPE_ORDER.map((t) => (
            <label
              key={t}
              className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] transition-colors ${
                venueTypes[t]
                  ? "border-accent/50 bg-accent/12 text-emerald-200 shadow-glow-sm backdrop-blur-md"
                  : "border-white/10 bg-white/5 text-slate-400 backdrop-blur-md hover:border-slate-300/40"
              }`}
            >
              <input
                type="checkbox"
                checked={venueTypes[t]}
                onChange={() => toggleType(t)}
                className="h-3 w-3 accent-emerald-500"
              />
              <span className="truncate">{VENUE_TYPE_LABELS[t]}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="border-t border-white/10 pt-3">
        <span className="text-chrome mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-[0.2em]">
          Seuil de présence numérique
        </span>
        <div className="space-y-1.5">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={digital.noWebsiteOnly}
              onChange={(e) => onDigital({ ...digital, noWebsiteOnly: e.target.checked })}
              className="h-3.5 w-3.5 accent-emerald-500"
            />
            Sans site web réel
          </label>
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={digital.maxReviews != null}
              onChange={(e) =>
                onDigital({ ...digital, maxReviews: e.target.checked ? 20 : null })
              }
              className="h-3.5 w-3.5 accent-emerald-500"
            />
            <span>≤</span>
            <input
              type="number"
              min={0}
              value={digital.maxReviews ?? ""}
              onChange={(e) =>
                onDigital({
                  ...digital,
                  maxReviews: e.target.value === "" ? null : Math.max(0, Number(e.target.value)),
                })
              }
              disabled={digital.maxReviews == null}
              className="w-16 rounded-lg border border-white/15 bg-black/35 px-1.5 py-0.5 text-xs text-slate-100 backdrop-blur-md disabled:opacity-40"
            />
            <span>avis Google</span>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={digital.highPriorityOnly}
              onChange={(e) => onDigital({ ...digital, highPriorityOnly: e.target.checked })}
              className="h-3.5 w-3.5 accent-emerald-500"
            />
            Cibles prioritaires uniquement (score &lt; 40)
          </label>
        </div>
      </div>

      <div className="border-t border-white/10 pt-3">
        <span className="text-chrome mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-[0.2em]">
          Légende
        </span>
        <ul className="space-y-1 text-[11px] text-slate-400">
          <li className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-600 shadow-[0_0_8px_rgba(168,40,63,0.8)]" />
            Bordeaux — cible prioritaire
          </li>
          <li className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" />
            Laiton — priorité moyenne
          </li>
          <li className="flex items-center gap-2">
            <span className="dot-accent inline-block h-2.5 w-2.5 rounded-full" />
            Bleu — présence numérique solide (à écarter)
          </li>
        </ul>
      </div>

      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          onDigital({ noWebsiteOnly: true, maxReviews: 20, highPriorityOnly: true })
        }
        className="w-full justify-center"
      >
        Réappliquer le préréglage prospection
      </Button>
    </div>
  );
}
