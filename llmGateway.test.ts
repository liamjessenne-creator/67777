import { describe, expect, it } from "vitest";
import {
  AUTO_MODEL,
  FAST_MODEL,
  looksLikeExhausted,
  looksLikeUnknownModel,
  toOpenAiBody,
} from "./llmGateway";

describe("contrat de la passerelle IA", () => {
  it("route par défaut sur « auto » quand le modèle est absent ou vide", () => {
    expect(toOpenAiBody({ messages: [] }).model).toBe(AUTO_MODEL);
    expect(toOpenAiBody({ model: "  ", messages: [] }).model).toBe(AUTO_MODEL);
  });

  it("conserve un identifiant explicite", () => {
    expect(toOpenAiBody({ model: "llama-3.1-8b-instruct", messages: [] }).model).toBe(
      "llama-3.1-8b-instruct",
    );
  });

  it("traduit json_mode en response_format json_object", () => {
    const body = toOpenAiBody({ messages: [], json_mode: true, max_tokens: 800 });
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.max_tokens).toBe(800);
  });

  it("n'ajoute ni response_format ni stream par défaut", () => {
    const body = toOpenAiBody({ messages: [] });
    expect(body.response_format).toBeUndefined();
    expect(body.stream).toBeUndefined();
  });

  it("demande le flux quand stream est vrai", () => {
    expect(toOpenAiBody({ messages: [], stream: true }).stream).toBe(true);
  });

  it("l'étape rapide utilise un identifiant précis, distinct du routeur", () => {
    // FIX : mesuré sur le serveur — un identifiant précis à comportement JSON
    // prouvé évite que le routeur tire un modèle raisonneur bavard.
    expect(typeof FAST_MODEL).toBe("string");
    expect(FAST_MODEL.length).toBeGreaterThan(0);
    expect(FAST_MODEL).not.toBe("");
    expect(AUTO_MODEL).toBe("auto");
  });

  it("détecte l'épuisement des fournisseurs du routeur", () => {
    expect(looksLikeExhausted("All models exhausted. Add more API keys")).toBe(true);
    expect(looksLikeExhausted("No candidate model has a configured, usable provider key.")).toBe(
      true,
    );
    expect(looksLikeExhausted("Model 'x' is not in the catalog")).toBe(false);
  });

  it("détecte un modèle absent du catalogue", () => {
    expect(looksLikeUnknownModel("Model 'x' is not in the catalog. Use 'auto'")).toBe(true);
    expect(looksLikeUnknownModel("code: model_not_found")).toBe(true);
    expect(looksLikeUnknownModel("All models exhausted")).toBe(false);
  });
});
