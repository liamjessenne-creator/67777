/** Settings modal — LLM API key, base URL, model selection + optional Google Places key. */

import { useState } from "react";
import { KeyRound, MapPinned, ShieldCheck } from "lucide-react";
import { AIAgentService, AiAgentError } from "./aiAgent";
import { DIRECT_AI_KEY_ALLOWED, isProxyConfigured } from "./aiProxy";
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
    };
    const nextPlaces: PlacesSettings = {
      apiKey: placesKey.trim(),
      enabled: placesEnabled && placesKey.trim().length > 0,
    };
    onSaveAi(nextAi);
    onSavePlaces(nextPlaces);

    // // FIX (POINT 1) : sans passerelle Edge, une analyse n'est possible qu'en
    // développement ET avec l'autorisation explicite de la clé locale.
    if (!isProxyConfigured(nextAi.proxyUrl) && !(DIRECT_AI_KEY_ALLOWED && nextAi.apiKey)) {
      setTestResult({
        ok: false,
        msg: "Renseignez l'URL de la fonction Edge Supabase (recommandé) : c'est elle qui détient la clé, jamais le navigateur.",
      });
      setTesting(false);
      return;
    }
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
          {/* FIX (PROBLÈME 1) : passerelle serveur = chemin recommandé. */}
          <section className="rounded-lg border border-accent/30 bg-accent/5 px-3 py-3">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-300">
              <ShieldCheck size={13} /> Passerelle d'analyse (recommandé)
            </h3>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
              URL de la fonction Edge Supabase. Elle seule détient la clé Groq : aucune clé ne
              circule dans le navigateur. Déploiement décrit dans <code>supabase/README.md</code>.
            </p>
            <div className="mt-2">
              <input
                type="url"
                value={proxyUrl}
                onChange={(e) => setProxyUrl(e.target.value)}
                placeholder="https://<projet>.supabase.co/functions/v1/groq"
                className={inputClass}
                spellCheck={false}
              />
            </div>
            {isProxyConfigured(proxyUrl) ? (
              <p className="mt-2 text-[11px] text-emerald-300">
                Passerelle configurée — les analyses passent par le serveur.
              </p>
            ) : (
              <p className="mt-2 text-[11px] text-amber-300">
                Aucune passerelle configurée : les analyses sont indisponibles.
                {DIRECT_AI_KEY_ALLOWED
                  ? " La clé du navigateur est utilisée car le mode développement est explicitement autorisé."
                  : " Déployez la fonction Edge (supabase/README.md) pour activer l'analyse."}
              </p>
            )}
          </section>

          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            <KeyRound size={13} className="text-accent" /> Fournisseur du modèle (compatible OpenAI)
          </h3>
          <Field
            label="Clé API — mode développement uniquement"
            hint="À laisser vide en production : utilisez la passerelle ci-dessus pour que la clé reste côté serveur."
          >
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="gsk_..."
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
            hint="Modèles proposés vérifiés sur Groq. Vous pouvez saisir n'importe quel identifiant pour un autre fournisseur compatible OpenAI."
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
            <ShieldCheck size={12} className="mt-0.5 shrink-0" /> Les clés ne quittent jamais votre
            navigateur, sauf pour appeler directement les API concernées.
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
