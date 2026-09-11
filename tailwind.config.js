/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#0b0f14",
          raised: "#11161d",
          overlay: "#161d26",
          border: "#1f2937",
        },
        accent: {
          DEFAULT: "#10b981",
          soft: "#34d399",
          dim: "#064e3b",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      boxShadow: {
        glow: "0 0 18px rgba(16, 185, 129, 0.28)",
        "glow-sm": "0 0 10px rgba(16, 185, 129, 0.22)",
        "glow-red": "0 0 14px rgba(239, 68, 68, 0.25)",
        "glow-amber": "0 0 14px rgba(245, 158, 11, 0.22)",
      },
    },
  },
  plugins: [],
};