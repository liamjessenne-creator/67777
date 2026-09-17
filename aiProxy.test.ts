/**
 * Tests du client de la fonction Edge (PROBLÈME 1 — fiabilité).
 * Le réseau est simulé : aucune requête réelle n'est émise.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { AiProxyError, callAiProxy, isProxyConfigured } from "./aiProxy";

const URL = "https://projet.supabase.co/functions/v1/groq";
const messages = [{ role: "user" as const, content: "test" }];

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("isProxyConfigured", () => {
  it("détecte une passerelle renseignée et ignore les espaces", () => {
    expect(isProxyConfigured(URL)).toBe(true);
    expect(isProxyConfigured("   ")).toBe(false);
    expect(isProxyConfigured(null)).toBe(false);
  });
});

describe("callAiProxy", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renvoie le contenu du modèle en cas de succès", async () => {
    vi.stubGlobal("fetch", async () => jsonResponse({ ok: true, content: "Bonjour" }));
    await expect(callAiProxy(URL, { messages })).resolves.toBe("Bonjour");
  });

  it("réessaie automatiquement après un 503 puis réussit", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      if (calls === 1) return jsonResponse({ error: "indisponible" }, 503);
      return jsonResponse({ ok: true, content: "Deuxième essai" });
    });
    await expect(callAiProxy(URL, { messages })).resolves.toBe("Deuxième essai");
    expect(calls).toBe(2);
  });

  it("remonte le message français renvoyé par la fonction", async () => {
    vi.stubGlobal("fetch", async () =>
      jsonResponse({ ok: false, error: "Oups, l'analyse a échoué. Réessaie." }, 502),
    );
    await expect(callAiProxy(URL, { messages })).rejects.toThrow(/Oups, l'analyse a échoué/);
  });

  it("échoue proprement si la réponse n'est pas du JSON", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>erreur</html>", { status: 500 }));
    await expect(callAiProxy(URL, { messages })).rejects.toBeInstanceOf(AiProxyError);
  });

  it("valide le JSON quand le mode JSON est demandé", async () => {
    vi.stubGlobal("fetch", async () => jsonResponse({ ok: true, content: "pas du json" }));
    await expect(callAiProxy(URL, { messages, jsonMode: true })).rejects.toThrow(
      /format exploitable/,
    );
  });

  it("accepte un JSON valide entouré de texte", async () => {
    vi.stubGlobal("fetch", async () =>
      jsonResponse({ ok: true, content: 'Voici le résultat : {"ville":"Lyon"}' }),
    );
    await expect(callAiProxy(URL, { messages, jsonMode: true })).resolves.toContain("Lyon");
  });
});
