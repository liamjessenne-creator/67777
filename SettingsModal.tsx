/** Settings modal — LLM API key, base URL, model selection + optional Google Places key. */

import { useState } from "react";
import { KeyRound, MapPinned, ShieldCheck } from "lucide-react";
import { AIAgentService, AiAgentError } from "./aiAgent";
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
  const [model, setModel] = useState<AiSettings["model"]>(aiSettings.model);
  const [placesKey, setPlacesKey] = useState(placesSettings.apiKey);
  const [placesEnabled, setPlacesEnabled] = useState(placesSettings.enabled);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const handleSaveAndTest = async () => {
    setTesting(true);
    setTestResult(null);
    const nextAi: AiSettings = { apiKey: apiKey.trim(), baseUrl: baseUrl.trim(), model };
    const nextPlaces: PlacesSettings = {
      apiKey: placesKey.trim(),
      enabled: placesEnabled && placesKey.trim().length > 0,
    };
    onSaveAi(nextAi);
    onSavePlaces(nextPlaces);

    if (!nextAi.apiKey) {
      setTestResult({ ok: false, msg: "Aucune clé API renseignée." });
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
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            <KeyRound size={13} className="text-accent" /> Fournisseur du modèle (compatible OpenAI)
          </h3>
          <Field
            label="Clé API (Groq, DeepSeek, Qwen…)"
            hint="Conservée uniquement dans le stockage local de ce navigateur."
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

        <section className="space-y-3 border-t border-surface-border pt-4">
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

        <div className="flex items-center justify-between border-t border-surface-border pt-4">
          <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <ShieldCheck size={12} /> Les clés ne quittent jamais votre navigateur, sauf pour
            appeler directement les API concernées.
          </span>
          <div className="flex gap-2">
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
