/** @type {import('tailwindcss').Config} */

/**
 * PALETTE « CHROME & LIQUID GLASS »
 *
 * Les rampes `slate`, `red`, `emerald` et `sky` sont REDÉFINIES ici, ce qui
 * bascule toute l'application d'un coup, sans toucher aux composants :
 *   - `slate`    → rampe CHROME (argent métallique légèrement bleuté) ;
 *   - `emerald`  → bleu/blanc (l'ancien vert : l'accent animé du site) ;
 *   - `red`      → BORDEAUX classe (erreurs, criticité, priorités hautes) ;
 *   - `sky`      → platine (informations secondaires, qualité de site) ;
 *   - `amber`    → laiton discret (avertissements « à confirmer »).
 */
const chrome = {
  50: "#ffffff",
  100: "#f5f8fb",
  200: "#e1e8f0",
  300: "#c5cfda",
  400: "#a2aebc",
  500: "#7f8b99",
  600: "#5d6672",
  700: "#3f4750",
  800: "#272d34",
  900: "#171b20",
  950: "#0a0d10",
};

/** Bleu/blanc : c'est l'accent « vivant » du site (dégradés animés). */
const blueWhite = {
  50: "#f4faff",
  100: "#e0f1ff",
  200: "#c2e5ff",
  300: "#96d3ff",
  400: "#61b8ff",
  500: "#2f9bf5",
  600: "#1a7ed6",
  700: "#1662a5",
  800: "#164d7d",
  900: "#123b5e",
  950: "#0a2338",
};

/** Bordeaux : remplace le rouge vif (erreurs, criticité). */
const bordeaux = {
  50: "#fdf3f5",
  100: "#fbe4e9",
  200: "#f4c3cd",
  300: "#e795a7",
  400: "#d2647c",
  500: "#a8283f",
  600: "#8c1f34",
  700: "#6f1828",
  800: "#4d1019",
  900: "#33090f",
  950: "#1e050a",
};

/** Platine : informations froides, distinctes de l'accent bleu animé. */
const platinum = {
  50: "#fbfdfe",
  100: "#f3f7fa",
  200: "#e6edf3",
  300: "#cfdae4",
  400: "#b1bfcd",
  500: "#93a2b1",
  600: "#778595",
  700: "#5c6874",
  800: "#3f4854",
  900: "#252c34",
  950: "#14181d",
};

/** Laiton : avertissements, sans crier. */
const brass = {
  50: "#fdf9ef",
  100: "#fbf0d8",
  200: "#f5dfae",
  300: "#ecc97c",
  400: "#dfae53",
  500: "#c98f2e",
  600: "#a97122",
  700: "#83551d",
  800: "#5c3b17",
  900: "#3a2510",
  950: "#20150a",
};

export default {
  content: ["./index.html", "./*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Fond « verre fumé » très légèrement bleuté (accordé au fond ChromeCells).
        surface: {
          DEFAULT: "#080b0f",
          raised: "#0e1319",
          overlay: "#141b24",
          border: "#26303c",
        },
        slate: chrome,
        emerald: blueWhite,
        red: bordeaux,
        bordeaux,
        sky: platinum,
        platinum,
        amber: brass,
        brass,
        accent: {
          // Accent principal : bleu/blanc (les dégradés animés vivent en CSS).
          DEFAULT: "#61b8ff",
          soft: "#c2e5ff",
          dim: "#164d7d",
        },
      },
      fontFamily: {
        // Corps d'interface : Manrope — géométrique, très lisible en petit corps.
        sans: [
          "Manrope Variable",
          "Manrope",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
        // Titres / marque : Sora — dessin large et technique, accordé au fond chrome.
        display: [
          "Sora Variable",
          "Sora",
          "Manrope Variable",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono Variable",
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      boxShadow: {
        // Lueurs désormais bleues (accent vivant) et bordeaux (erreurs).
        glow: "0 0 20px rgba(97, 184, 255, 0.32)",
        "glow-sm": "0 0 10px rgba(97, 184, 255, 0.24)",
        "glow-lg": "0 0 38px rgba(97, 184, 255, 0.38)",
        "glow-red": "0 0 16px rgba(168, 40, 63, 0.42)",
        "glow-amber": "0 0 14px rgba(223, 174, 83, 0.24)",
        // Relief « liquid glass » : liseré haut lumineux + profondeur basse.
        glass:
          "inset 0 1px 0 rgba(255,255,255,0.16), inset 0 -1px 0 rgba(0,0,0,0.42), 0 18px 44px rgba(0,0,0,0.5)",
        "glass-sm":
          "inset 0 1px 0 rgba(255,255,255,0.12), 0 8px 22px rgba(0,0,0,0.4)",
      },
      keyframes: {
        // Reflet spéculaire qui traverse une surface de verre.
        "liquid-sheen": {
          "0%": { backgroundPosition: "-150% 50%" },
          "100%": { backgroundPosition: "250% 50%" },
        },
        // Bleu ⇄ blanc : l'accent « vivant » (boutons, pastilles, chiffres).
        "accent-flow": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        // Balayage chrome lent sur les titres et la marque.
        "chrome-sweep": {
          "0%": { backgroundPosition: "0% 50%" },
          "100%": { backgroundPosition: "220% 50%" },
        },
        // Pulsation douce bleu → blanc des pastilles d'état.
        "pulse-accent": {
          "0%, 100%": { opacity: "1", boxShadow: "0 0 6px rgba(97,184,255,0.85)" },
          "50%": { opacity: "0.78", boxShadow: "0 0 16px rgba(255,255,255,0.6)" },
        },
      },
      animation: {
        "liquid-sheen": "liquid-sheen 7s linear infinite",
        "accent-flow": "accent-flow 6s ease-in-out infinite",
        chrome: "chrome-sweep 7s linear infinite",
        "pulse-accent": "pulse-accent 2.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
