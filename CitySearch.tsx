/** City autocomplete backed by Nominatim. */

import { MapPin, Search } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { searchCity } from "./geocoding";
import type { GeoPlace } from "./geocoding";
import { useDebouncedValue } from "./useDebouncedValue";

export function CitySearch({
  value,
  onChange,
  onSelect,
  onSubmit,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  /** `run` = l'utilisateur a validé au clavier : on enchaîne sur l'analyse. */
  onSelect: (place: GeoPlace, run?: boolean) => void;
  /** Entrée sans suggestion en attente (relance la ville déjà choisie). */
  onSubmit?: () => void;
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
        // // FIX : Nominatim renvoie parfois deux fois la même entité (nœud et
        // relation) — on n'affiche plus la même ville en double dans la liste.
        const seen = new Set<string>();
        setPlaces(results.filter((p) => !seen.has(p.displayName) && seen.add(p.displayName)));
        setOpen(true);
      })
      .catch((err) => {
        setPlaces([]);
        setOpen(false);
        setError(err instanceof Error ? err.message : "Recherche de ville impossible");
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

  const pick = (place: GeoPlace, run = false) => {
    pickedRef.current = true;
    onChange(place.shortName + (place.country ? `, ${place.country}` : ""));
    setOpen(false);
    onSelect(place, run);
  };

  /**
   * // FIX (mobile & clavier) : la touche Entrée n'avait AUCUN effet — sur
   * téléphone, taper une ville puis valider ne lançait rien. Désormais Entrée
   * choisit la première suggestion et démarre l'analyse dans la foulée ; si
   * aucune suggestion n'est ouverte, elle relance la ville déjà sélectionnée.
   */
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (open && places.length > 0) pick(places[0], true);
    else onSubmit?.();
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
          onKeyDown={onKeyDown}
          placeholder="Recherchez une ville ou un quartier (ex. Lyon 4e, Villeurbanne)…"
          disabled={disabled}
          className="w-full rounded-xl border border-white/15 bg-black/35 py-2.5 pl-9 pr-3 text-sm text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),inset_0_-1px_0_rgba(0,0,0,0.4)] backdrop-blur-md transition-colors placeholder-slate-600 focus:border-accent/70 focus:outline-none focus:ring-1 focus:ring-accent/50 disabled:opacity-50"
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
        <ul className="glass-strong absolute z-[1100] mt-1 w-full overflow-hidden rounded-xl">
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
