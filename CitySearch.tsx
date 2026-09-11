/** City autocomplete backed by Nominatim. */

import { MapPin, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { searchCity } from "./nominatim";
import type { GeoPlace } from "./nominatim";
import { useDebouncedValue } from "./useDebouncedValue";

export function CitySearch({
  value,
  onChange,
  onSelect,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (place: GeoPlace) => void;
  disabled?: boolean;
}) {
  const [places, setPlaces] = useState<GeoPlace[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounced = useDebouncedValue(value, 250);
  const boxRef = useRef<HTMLDivElement>(null);
  /** Set after picking a suggestion: don't re-run the search on the filled value. */
  const pickedRef = useRef(false);

  useEffect(() => {
    if (pickedRef.current) return;
    const q = debounced.trim();
    setError(null);
    if (q.length < 3) {
      setPlaces([]);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    searchCity(q, controller.signal)
      .then((results) => {
        setPlaces(results);
        setOpen(true);
      })
      .catch((err) => {
        setPlaces([]);
        setOpen(false);
        setError(err instanceof Error ? err.message : "City search failed");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [debounced]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const pick = (place: GeoPlace) => {
    pickedRef.current = true;
    onChange(place.shortName + (place.country ? `, ${place.country}` : ""));
    setOpen(false);
    onSelect(place);
  };

  return (
    <div ref={boxRef} className="relative flex-1">
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          value={value}
          onChange={(e) => {
            pickedRef.current = false; // user is typing again → search resumes
            onChange(e.target.value);
          }}
          onFocus={() => places.length > 0 && setOpen(true)}
          placeholder="Search a city or district (e.g. Lyon 4e, Villeurbanne)…"
          disabled={disabled}
          className="w-full rounded-md border border-surface-border bg-surface-raised py-2 pl-9 pr-3 text-sm text-slate-200 placeholder-slate-600 focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-50"
        />
        {loading ? (
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-600 border-t-accent" />
          </span>
        ) : null}
      </div>
      {error ? (
        <div className="mt-1 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 font-mono text-[10px] text-red-300">
          ⚠ {error}
        </div>
      ) : null}
      {open && places.length > 0 ? (
        <ul className="absolute z-[1100] mt-1 w-full overflow-hidden rounded-md border border-surface-border bg-surface-overlay shadow-2xl">
          {places.map((p) => (
            <li key={`${p.osmType}/${p.osmId}`}>
              <button
                onClick={() => pick(p)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-slate-300 hover:bg-slate-700/40 hover:text-slate-100"
              >
                <MapPin size={13} className="shrink-0 text-accent" />
                <span className="truncate">{p.displayName}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
