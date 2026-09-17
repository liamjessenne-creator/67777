/**
 * // FIX (PROBLÈME 1 — fiabilité)
 *
 * Garde-fou GLOBAL de l'interface. Avant, la moindre exception de rendu
 * (par exemple une donnée corrompue dans le localStorage, un lead au format
 * inattendu, ou une extension de navigateur) démontait tout l'arbre React :
 * l'écran devenait BLANC, sans aucun message. C'est exactement le symptôme
 * « parfois ça marche, parfois rien ne s'affiche, sans erreur visible ».
 *
 * Désormais : message clair en français + possibilité de réessayer ou de
 * réinitialiser l'application, et l'erreur exacte est loguée en console.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { logError } from "./net";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Erreur exacte + composant fautif : visibles dans la console du navigateur.
    logError("ui", error, { composant: String(info.componentStack ?? "").slice(0, 400) });
  }

  private readonly retry = () => this.setState({ error: null });

  private readonly hardReset = () => {
    try {
      localStorage.clear();
    } catch {
      /* stockage inaccessible — on recharge quand même */
    }
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-950 p-6">
        <div className="w-full max-w-lg rounded-xl border border-red-500/40 bg-slate-900/85 p-6 text-slate-200 backdrop-blur">
          <h1 className="text-sm font-bold text-red-300">Une erreur est survenue dans l'interface</h1>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            Les données enregistrées dans ce navigateur sont peut-être corrompues. Vous pouvez
            réessayer, ou repartir de zéro (efface les réglages et les résultats stockés localement).
          </p>
          <pre className="mt-3 max-h-32 overflow-auto rounded bg-black/50 p-2 font-mono text-[10px] text-red-300">
            {this.state.error.message}
          </pre>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={this.retry}
              className="rounded-md bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-emerald-400"
            >
              Réessayer
            </button>
            <button
              onClick={this.hardReset}
              className="rounded-md border border-red-500/40 px-3 py-2 text-xs text-red-300 transition-colors hover:bg-red-500/10"
            >
              Réinitialiser l'application
            </button>
          </div>
        </div>
      </div>
    );
  }
}
