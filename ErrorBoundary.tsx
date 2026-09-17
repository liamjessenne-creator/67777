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
import { Button } from "./ui";

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
        <div className="glass-strong glass-live w-full max-w-lg rounded-2xl border-red-400/40 p-6 text-slate-200">
          <h1 className="text-chrome text-sm font-bold">Une erreur est survenue dans l'interface</h1>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            Les données enregistrées dans ce navigateur sont peut-être corrompues. Vous pouvez
            réessayer, ou repartir de zéro (efface les réglages et les résultats stockés localement).
          </p>
          <pre className="mt-3 max-h-32 overflow-auto rounded-lg border border-white/10 bg-black/55 p-2 font-mono text-[10px] text-red-200">
            {this.state.error.message}
          </pre>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={this.retry}>
              Réessayer
            </Button>
            <Button variant="danger" onClick={this.hardReset}>
              Réinitialiser l'application
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
