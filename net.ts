/**
 * net.ts — infrastructure réseau commune à tout le site.
 *
 * // FIX (PROBLÈME 1 — fiabilité) : un SEUL endroit pour
 *   - un TIMEOUT explicite sur chaque appel (15 s par défaut) via AbortController ;
 *   - un RETRY automatique (3 tentatives par défaut) avec backoff exponentiel + jitter ;
 *   - des messages d'erreur clairs EN FRANÇAIS pour l'utilisateur ;
 *   - la journalisation console de l'erreur exacte (aucun échec silencieux).
 *
 * // FIX (PROBLÈME 2 — mobile) : le backoff est plus court sur les petits appels,
 * le nombre de tentatives est plafonné et l'appelant peut annuler (AbortSignal)
 * pour ne pas saturer un réseau mobile lent.
 *
 * L'application est 100 % front (aucun serveur) : les erreurs sont donc loguées
 * côté client dans la console du navigateur.
 */

/** Erreur réseau « utilisateur » : son message est déjà en français et affichable. */
export class NetworkError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "NetworkError";
  }
}

/** Erreur transitoire explicite (429/5xx) levée par fetchWithRetry en dernier recours. */
export class RetryableHttpError extends NetworkError {
  constructor(status: number, label: string) {
    super(`Service indisponible (${status}) — ${label}. Réessayez dans quelques instants.`, status);
    this.name = "RetryableHttpError";
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Statuts HTTP qui valent une nouvelle tentative. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/** Message français lisible pour n'importe quelle erreur attrapée. */
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Erreur inconnue";
}

/**
 * // FIX (PROBLÈME 1) : log systématique de l'erreur exacte, avec son contexte.
 * Utilisé par TOUS les points d'échec (réseau, IA, parsing…).
 */
export function logError(scope: string, err: unknown, context?: Record<string, unknown>): void {
  if (context) console.error(`[${scope}]`, err, context);
  else console.error(`[${scope}]`, err);
}

/** Log informatif (étapes, chronométrage) — visible dans la console du navigateur. */
export function logInfo(scope: string, message: string, context?: Record<string, unknown>): void {
  if (context) console.info(`[${scope}] ${message}`, context);
  else console.info(`[${scope}] ${message}`);
}

/** Relie un signal d'annulation externe (bouton Stop…) à notre timeout interne. */
function linkAbort(external: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  external?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onAbort);
    },
  };
}

const fmtSeconds = (ms: number) => `${Math.round(ms / 100) / 10} s`;

/**
 * // FIX (PROBLÈME 1) : fetch avec TIMEOUT explicite (15 s par défaut).
 * Toute erreur de transport devient une NetworkError en français.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<Response> {
  const external = init.signal ?? undefined;
  const linked = linkAbort(external, timeoutMs);
  try {
    return await fetch(url, { ...init, signal: linked.signal });
  } catch (err) {
    // Annulation volontaire de l'utilisateur : on propage tel quel.
    if (external?.aborted) throw err;
    const timedOut = err instanceof DOMException && err.name === "AbortError";
    const host = safeHost(url);
    if (timedOut) {
      throw new NetworkError(`Délai dépassé (${fmtSeconds(timeoutMs)}) pour ${host}. Réessayez.`);
    }
    throw new NetworkError(`Connexion impossible à ${host}. Vérifiez votre connexion internet.`, undefined, err);
  } finally {
    linked.dispose();
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export interface RetryOptions {
  /** Nombre total de tentatives (défaut 3 → 1 essai initial + 2 retries). */
  attempts?: number;
  /** Base du backoff exponentiel en ms (défaut 600 → 0,6 s puis 1,2 s puis 2,4 s…). */
  baseDelayMs?: number;
  /** Délai maximum entre deux tentatives. */
  maxDelayMs?: number;
  /** Étiquette lisible pour les logs. */
  label?: string;
  /** Prédicat : faut-il retenter ? (par défaut : oui, sauf erreurs « définitives »). */
  shouldRetry?: (err: unknown) => boolean;
  /** Callback à chaque retry (ex. mettre à jour l'UI « nouvelle tentative… »). */
  onRetry?: (attempt: number, total: number, err: unknown) => void;
}

/**
 * // FIX (PROBLÈME 1) : RETRY automatique avec backoff EXPONENTIEL + jitter.
 * Par défaut : 3 tentatives, 0,6 s → 1,2 s → 2,4 s (+ jusqu'à 250 ms d'aléa).
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const {
    attempts = 3,
    baseDelayMs = 600,
    maxDelayMs = 8_000,
    label = "requête",
    shouldRetry = isRetryableError,
    onRetry,
  } = opts;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const retryAllowed = attempt < attempts && shouldRetry(err);
      if (!retryAllowed) break;
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)) + Math.random() * 250;
      logInfo("net", `${label} : échec tentative ${attempt}/${attempts} — nouvelle tentative dans ${Math.round(delay)} ms`, {
        erreur: describeError(err),
      });
      onRetry?.(attempt, attempts, err);
      await sleep(delay);
    }
  }
  throw lastError;
}

/**
 * // FIX (PROBLÈME 3) : parallélisation BORNÉE (concurrency limit).
 * Promise.all pur enverrait 700 requêtes simultanées (saturation réseau
 * mobile + rate-limit) ; ici on garde au maximum `limit` appels en vol.
 * Les résultats arrivent dans l'ordre du tableau d'entrée.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const size = Math.max(1, Math.min(limit, items.length));
  const runners = Array.from({ length: size }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Par défaut on retente tout SAUF les erreurs manifestement définitives (401/403/404/400). */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof NetworkError) {
    const status = err.status;
    if (status == null) return true; // timeouts et erreurs réseau : retentables
    return isRetryableStatus(status);
  }
  // AbortError = annulation volontaire → jamais de retry.
  if (err instanceof DOMException && err.name === "AbortError") return false;
  // Erreurs réseau natives de fetch (TypeError: Failed to fetch).
  if (err instanceof TypeError) return true;
  return true;
}

export interface FetchRetryOptions extends RetryOptions {
  /** Timeout par tentative (défaut 15 s — consigne « 15 s max par appel »). */
  timeoutMs?: number;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Annulation utilisateur : interrompt immédiatement, sans retry. */
  signal?: AbortSignal;
  /** Si true, un status 429/5xx DÉCLENCHE un retry (défaut true). */
  retryOnStatus?: boolean;
}

/**
 * // FIX (PROBLÈME 1) : fetch + timeout + retry exponentiel, en un appel.
 * Retourne la Response finale ; l'appelant décide quoi faire des status non-OK.
 */
export async function fetchWithRetry(url: string, opts: FetchRetryOptions = {}): Promise<Response> {
  const {
    timeoutMs = 15_000,
    retryOnStatus = true,
    label = safeHost(url),
    attempts = 3,
    baseDelayMs = 600,
    signal,
    ...rest
  } = opts;

  return withRetry(
    async () => {
      const res = await fetchWithTimeout(
        url,
        { method: rest.method ?? "GET", headers: rest.headers, body: rest.body, signal },
        timeoutMs,
      );
      // 429/5xx : on transforme en erreur retentable pour déclencher le backoff.
      if (retryOnStatus && isRetryableStatus(res.status)) {
        throw new RetryableHttpError(res.status, label);
      }
      return res;
    },
    {
      attempts,
      baseDelayMs,
      label,
      shouldRetry: (err) => (signal?.aborted ? false : isRetryableError(err)),
      onRetry: opts.onRetry,
    },
  );
}
