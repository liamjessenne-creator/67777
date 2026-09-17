import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// FIX (PROBLÈME 1) : plus jamais de page blanche silencieuse — toute erreur de
// rendu affiche un message clair en français au lieu de « rien ne s'affiche ».
import { ErrorBoundary } from "./ErrorBoundary";
// Typographie embarquée : Sora (titres/chrome), Manrope (interface),
// JetBrains Mono (chiffres, données, code). Chargée localement, sans CDN.
import "@fontsource-variable/sora";
import "@fontsource-variable/manrope";
import "@fontsource-variable/jetbrains-mono";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
