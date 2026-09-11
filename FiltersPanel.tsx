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
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
            Venue types
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setAll(true)}
              className="text-[10px] text-slate-500 hover:text-accent"
            >
              all
            </button>
            <span className="text-[10px] text-slate-700">/</span>
            <button
              onClick={() => setAll(false)}
              className="text-[10px] text-slate-500 hover:text-accent"
            >
              none
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {TYPE_ORDER.map((t) => (
            <label
              key={t}
              className={`flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1.5 text-[11px] transition-colors ${
                venueTypes[t]
                  ? "border-accent/50 bg-accent/10 text-emerald-300 shadow-glow-sm"
                  : "border-surface-border bg-surface-raised text-slate-400 hover:border-slate-500"
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

      <div className="border-t border-surface-border pt-3">
        <span className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
          Digital footprint threshold
        </span>
        <div className="space-y-1.5">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={digital.noWebsiteOnly}
              onChange={(e) => onDigital({ ...digital, noWebsiteOnly: e.target.checked })}
              className="h-3.5 w-3.5 accent-emerald-500"
            />
            No real website
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
              className="w-16 rounded border border-surface-border bg-surface-raised px-1.5 py-0.5 text-xs text-slate-200 disabled:opacity-40"
            />
            <span>Google reviews</span>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={digital.highPriorityOnly}
              onChange={(e) => onDigital({ ...digital, highPriorityOnly: e.target.checked })}
              className="h-3.5 w-3.5 accent-emerald-500"
            />
            High-priority targets only (score &lt; 40)
          </label>
        </div>
      </div>

      <div className="border-t border-surface-border pt-3">
        <span className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
          Map legend
        </span>
        <ul className="space-y-1 text-[11px] text-slate-400">
          <li className="flex items-center gap-2">
            <span className="lead-pin lead-pin--high inline-block h-2.5 w-2.5" />
            Red — high prospect priority
          </li>
          <li className="flex items-center gap-2">
            <span className="lead-pin lead-pin--medium inline-block h-2.5 w-2.5" />
            Yellow — medium prospect priority
          </li>
          <li className="flex items-center gap-2">
            <span className="lead-pin lead-pin--low inline-block h-2.5 w-2.5" />
            Green — strong digital presence (disqualified)
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
        Reset to prospect preset
      </Button>
    </div>
  );
}
