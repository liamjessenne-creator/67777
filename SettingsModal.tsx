/** Settings modal — LLM API key, base URL, model selection + optional Google Places key. */

import { useState } from "react";
import { Cloud, KeyRound, MapPinned, MonitorSmartphone, ShieldCheck } from "lucide-react";
import { AIAgentService, AiAgentError } from "./aiAgent";
import { LLM_GATEWAY_DEFAULT_URL, type AiProvider } from "./llmGateway";
import type { AiSettings } from "./types";
import { AI_MODELS } from "./types";
import type { PlacesSettings } from "./places";
import { Button, Field, Modal, Spinner, inputClass } from "./ui";

interface Props {
  open: boolean;
  onClose: () => void;
  aiSettings: AiSettings;
  placesSettings: PlacesSettings;
  onSaveAi: (s: AiSettings) => void;
  onSavePlaces: (s: PlacesSettings) => void;
}

export function SettingsModal({
  open,
  onClose,
  aiSettings,
  placesSettings,
  onSaveAi,
  onSavePlaces,
}: Props) {
  const [apiKey, setApiKey] = useState(aiSettings.apiKey);
  const [baseUrl, setBaseUrl] = useState(aiSettings.baseUrl);
  // FIX (PROBLÈME 1) : URL de la fonction Edge Supabase (clé côté serveur).
  const [proxyUrl, setProxyUrl] = useState(aiSettings.proxyUrl ?? "");
  const [model, setModel] = useState<AiSettings["model"]>(aiSettings.model);
  // // FIX (choix du fournisseur) : OpenRouter (hébergé) ou serveur LOCAL.
  const [provider, setProvider] = useState<AiProvider>(aiSettings.provider ?? "openrouter");
  const [placesKey, setPlacesKey] = useState(placesSettings.apiKey);
  const [placesEnabled, setPlacesEnabled] = useState(placesSettings.enabled);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const handleSaveAndTest = async () => {
    setTesting(true);
    setTestResult(null);
    const nextAi: AiSettings = {
      apiKey: apiKey.trim(),
      baseUrl: baseUrl.trim(),
      model,
      proxyUrl: proxyUrl.trim(),
      provider,
    };
    const nextPlaces: PlacesSettings = {
      apiKey: placesKey.trim(),
      enabled: placesEnabled && placesKey.trim().length > 0,
    };
    onSaveAi(nextAi);
    onSavePlaces(nextPlaces);

    // // FIX (remplacement de Groq) : la passerelle est toujours fournie par
    // l'app (/api/llm) — plus de configuration préalable à exiger ici.
    try {
      const agent = new AIAgentService(nextAi);
      const reply = await agent.testConnection();
      setTestResult({ ok: true, msg: `Connexion établie — le modèle a répondu « ${reply} »` });
    } catch (err) {
      const msg =
        err instanceof AiAgentError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Erreur inconnue";
      setTestResult({ ok: false, msg });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Réglages">
      <div className="space-y-4">
        <section className="space-y-3">
          {/*
           * // FIX (choix du fournisseur) : onglets OpenRouter ↔ serveur LOCAL.
           * Les deux passent par la même passerelle /api/llm — seule la clé et
           * l'URL changent, et les deux restent côté serveur.
           */}
          <section className="rounded-lg border border-accent/30 bg-accent/5 px-3 py-3">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-300">
              <ShieldCheck size={13} /> Fournisseur d'analyse
            </h3>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setProvider("openrouter")}
                aria-pressed={provider === "openrouter"}
                className={`rounded-lg border px-3 py-2.5 text-left transition ${
                  provider === "openrouter"
                    ? "border-accent bg-accent/15 text-white"
                    : "border-white/10 bg-white/5 text-slate-300 hover:border-white/25"
                }`}
              >
                <span className="flex items-center gap-1.5 text-xs font-semibold">
                  <Cloud size={13} /> OpenRouter
                </span>
                <span className="mt-1 block text-[11px] leading-snug text-slate-400">
                  En ligne, marche même PC éteint
                </span>
              </button>
              <button
                type="button"
                onClick={() => setProvider("local")}
                aria-pressed={provider === "local"}
                className={`rounded-lg border px-3 py-2.5 text-left transition ${
                  provider === "local"
                    ? "border-accent bg-accent/15 text-white"
                    : "border-white/10 bg-white/5 text-slate-300 hover:border-white/25"
                }`}
              >
                <span className="flex items-center gap-1.5 text-xs font-semibold">
                  <MonitorSmartphone size={13} /> Serveur local
                </span>
                <span className="mt-1 block text-[11px] leading-snug text-slate-400">
                  Ta machine uniquement — démarre-le d'abord
                </span>
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
              {provider === "local" ? (
                <>
                  Les analyses passeront par le serveur compatible OpenAI de ta machine
                  (routeur « auto »). Il doit être démarré : si l'app est en ligne ou le
                  serveur éteint, l'analyse échouera — reviens alors sur OpenRouter.
                </>
              ) : (
                <>Les analyses passeront par OpenRouter (pool gratuit avec rotation automatique). Fonctionne en local comme en ligne, même PC éteint.</>
              )}
            </p>
            <div className="mt-2">
              <input
                type="text"
                value={proxyUrl}
                onChange={(e) => setProxyUrl(e.target.value)}
                placeholder={`${LLM_GATEWAY_DEFAULT_URL} (défaut)`}
                className={inputClass}
                spellCheck={false}
              />
            </div>
            <p className="mt-2 text-[11px] text-emerald-300">
              Passerelle active — la clé du fournisseur reste côté serveur.
            </p>
          </section>

          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            <KeyRound size={13} className="text-accent" /> Fournisseur du modèle (compatible OpenAI)
          </h3>
          <Field
            label="Clé API (optionnelle — appel direct hors passerelle)"
            hint="Laissez vide : la passerelle ci-dessus détient la clé côté serveur."
          >
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="facultatif"
              className={inputClass}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field label="URL de base">
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.groq.com/openai/v1"
              className={inputClass}
              spellCheck={false}
            />
          </Field>
          <Field
            label="Identifiant du modèle"
            hint="« auto » laisse le serveur choisir. Vous pouvez saisir n'importe quel identifiant du catalogue du serveur (voir /v1/models)."
          >
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              list="ai-model-presets"
              className={inputClass}
              spellCheck={false}
            />
            <datalist id="ai-model-presets">
              {AI_MODELS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>
        </section>

        <section className="space-y-3 border-t border-white/10 pt-4">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            <MapPinned size={13} className="text-accent" /> Google Places (optionnel — vrais nombres d'avis)
          </h3>
          <Field
            label="Clé API Google Places"
            hint="Clé de la nouvelle API Places. Google facture chaque requête."
          >
            <input
              type="password"
              value={placesKey}
              onChange={(e) => setPlacesKey(e.target.value)}
              placeholder="AIza..."
              className={inputClass}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={placesEnabled}
              onChange={(e) => setPlacesEnabled(e.target.checked)}
              className="h-4 w-4 accent-emerald-500"
            />
            Enrichir les fiches avec les notes et nombres d'avis Google réels
          </label>
        </section>

        {testResult ? (
          <div
            className={`rounded-md border px-3 py-2 text-xs ${
              testResult.ok
                ? "border-accent/40 bg-accent/10 text-emerald-300"
                : "border-red-500/40 bg-red-500/10 text-red-300"
            }`}
          >
            {testResult.ok ? "✓ " : "✗ "}
            {testResult.msg}
          </div>
        ) : null}

        {/* Sur écran étroit, la note et les boutons s'empilent : côte à côte, le
            texte se réduisait à une colonne de 2 mots sous les boutons. */}
        <div className="flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
            <ShieldCheck size={12} className="mt-0.5 shrink-0" /> La clé du serveur IA reste côté
            serveur : le navigateur ne l'expose jamais.
          </span>
          <div className="flex flex-wrap gap-2">
            <Button onClick={onClose}>Fermer</Button>
            <Button variant="primary" onClick={handleSaveAndTest} disabled={testing}>
              {testing ? <Spinner size={14} /> : null}
              {testing ? "Test en cours…" : "Enregistrer et tester"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
