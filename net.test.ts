/**
 * Tests de l'infrastructure réseau (PROBLÈME 1 & 3) :
 * retry exponentiel, timeouts, classification des erreurs, parallélisme borné.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NetworkError,
  fetchWithRetry,
  fetchWithTimeout,
  isRetryableError,
  mapLimit,
  withRetry,
} from "./net";

describe("withRetry", () => {
  it("réessaie puis réussit (2 échecs transitoires)", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new NetworkError("Connexion perdue");
        return "ok";
      },
      { attempts: 3, baseDelayMs: 1 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("abandonne après le nombre de tentatives prévu", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new NetworkError("Connexion perdue");
        },
        { attempts: 3, baseDelayMs: 1 },
      ),
    ).rejects.toBeInstanceOf(NetworkError);
    expect(calls).toBe(3);
  });

  it("NE réessaie PAS une erreur définitive (401)", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new NetworkError("Clé API invalide", 401);
        },
        { attempts: 3, baseDelayMs: 1 },
      ),
    ).rejects.toBeInstanceOf(NetworkError);
    expect(calls).toBe(1);
  });

  it("NE réessaie JAMAIS une annulation volontaire (AbortError)", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new DOMException("Aborted", "AbortError");
        },
        { attempts: 3, baseDelayMs: 1 },
      ),
    ).rejects.toBeTruthy();
    expect(calls).toBe(1);
  });

  it("signale chaque tentative via onRetry", async () => {
    const attempts: number[] = [];
    await withRetry(
      async () => {
        if (attempts.length < 2) throw new NetworkError("Connexion perdue");
        return 1;
      },
      { attempts: 3, baseDelayMs: 1, onRetry: (attempt) => attempts.push(attempt) },
    );
    expect(attempts).toEqual([1, 2]);
  });
});

describe("isRetryableError", () => {
  it("retente les erreurs réseau sans statut", () => {
    expect(isRetryableError(new NetworkError("timeout"))).toBe(true);
  });
  it("retente les 429 et 5xx", () => {
    expect(isRetryableError(new NetworkError("limite", 429))).toBe(true);
    expect(isRetryableError(new NetworkError("erreur serveur", 503))).toBe(true);
  });
  it("ne retente pas 401/404", () => {
    expect(isRetryableError(new NetworkError("clé", 401))).toBe(false);
    expect(isRetryableError(new NetworkError("absent", 404))).toBe(false);
  });
  it("ne retente pas une annulation", () => {
    expect(isRetryableError(new DOMException("Aborted", "AbortError"))).toBe(false);
  });
});

describe("mapLimit", () => {
  it("borne la concurrence et conserve l'ordre des résultats", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBeLessThanOrEqual(3);
  });
});

describe("fetchWithRetry / fetchWithTimeout", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("réessaie un 503 puis réussit", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      if (calls === 1) return new Response("busy", { status: 503 });
      return new Response("ok", { status: 200 });
    });
    const res = await fetchWithRetry("https://api.test/x", {
      attempts: 2,
      baseDelayMs: 1,
      timeoutMs: 1_000,
    });
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });

  it("échoue avec un message français clair après épuisement des tentatives", async () => {
    vi.stubGlobal("fetch", async () => new Response("busy", { status: 503 }));
    await expect(
      fetchWithRetry("https://api.test/x", { attempts: 2, baseDelayMs: 1, timeoutMs: 1_000 }),
    ).rejects.toThrow(/indisponible/i);
  });

  it("respecte le TIMEOUT explicite", async () => {
    vi.stubGlobal(
      "fetch",
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    await expect(fetchWithTimeout("https://slow.test", {}, 30)).rejects.toThrow(/Délai dépassé/);
  });
});
