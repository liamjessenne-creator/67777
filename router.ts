/**
 * Tiny hash router: #/ (app), #/mentions-legales, #/confidentialite, #/cgu.
 * Keeps the SPA deployable as static files (works from GitHub Pages, file://
 * previews and any static host without server rewrites).
 */

import { useEffect, useState } from "react";
import type { LegalPage } from "./types";

export type Route =
  | { role: "app" }
  | { role: "legal"; page: LegalPage };

const LEGAL_ROUTES: Record<string, LegalPage> = {
  "mentions-legales": "mentions",
  confidentialite: "privacy",
  cgu: "terms",
};

function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, "").replace(/\/$/, "");
  const page = LEGAL_ROUTES[path];
  return page ? { role: "legal", page } : { role: "app" };
}

/** Returns the current route and re-renders on hashchange. */
export function useRouter(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}

export function navigateTo(hash: string): void {
  window.location.hash = hash;
}
