/**
 * Small shared UI primitives — liquid glass, chrome text, animated blue/white accent.
 *
 * Les boutons sont désormais rendus par le composant fourni **Liquid Carve
 * Button** (forme creusée à la souris) posé sur une coque de verre liquide
 * (`.carve-glass`). L'API publique reste identique à avant (children, onClick,
 * variant, size, disabled, type, className, title) : aucun appelant à modifier.
 */

import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect } from "react";
import LiquidCarveButton from "./LiquidCarveButton";

/** Texte d'un contenu React (sert d'étiquette accessible et de libellé). */
function textOf(node: ReactNode): string {
  if (node == null || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ").trim();
  if (typeof node === "object" && "props" in (node as { props?: unknown })) {
    return textOf((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

const BUTTON_FONT = "Manrope Variable, Manrope, ui-sans-serif, system-ui, sans-serif";

type Variant = "default" | "primary" | "danger" | "ghost";

/** Coque de verre (CSS) + couleur de remplissage/bulle passée au composant. */
const SHELLS: Record<Variant, string> = {
  default: "",
  primary: "carve-glass-primary",
  danger: "carve-glass-danger",
  ghost: "carve-glass-ghost",
};

const PAINTS: Record<Variant, { fill: string; blob: string; text: string; weight: number }> = {
  default: { fill: "rgba(255,255,255,0.06)", blob: "rgba(255,255,255,0.85)", text: "#e1e8f0", weight: 500 },
  primary: { fill: "rgba(255,255,255,0.10)", blob: "rgba(255,255,255,0.95)", text: "#ffffff", weight: 700 },
  danger: { fill: "rgba(168,40,63,0.14)", blob: "rgba(210,100,124,0.45)", text: "#f4c3cd", weight: 600 },
  ghost: { fill: "rgba(255,255,255,0.02)", blob: "rgba(255,255,255,0.35)", text: "#a2aebc", weight: 500 },
};

const SIZES = {
  xs: { padding: "4px 10px", fontSize: 10, blob: 30 },
  sm: { padding: "6px 11px", fontSize: 11, blob: 40 },
  md: { padding: "9px 16px", fontSize: 13, blob: 54 },
  lg: { padding: "13px 26px", fontSize: 14, blob: 68 },
} as const;

export function Button({
  children,
  onClick,
  variant = "default",
  size = "md",
  disabled,
  type = "button",
  className = "",
  title,
  stopPropagation,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: Variant;
  size?: "xs" | "sm" | "md" | "lg";
  disabled?: boolean;
  /** Conservé pour compatibilité d'API (le bouton n'est plus un <button> natif). */
  type?: "button" | "submit";
  className?: string;
  title?: string;
  /** Empêche le clic de remonter au parent (lignes de tableau cliquables). */
  stopPropagation?: boolean;
}) {
  const paint = PAINTS[variant];
  const dims = SIZES[size];
  const label = textOf(children);
  void type;

  return (
    <span
      role="presentation"
      title={title}
      aria-disabled={disabled ? true : undefined}
      onClick={
        disabled
          ? undefined
          : (e) => {
              if (stopPropagation) e.stopPropagation();
              onClick?.();
            }
      }
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (stopPropagation) e.stopPropagation();
          onClick?.();
        }
      }}
      className={`carve-glass ${SHELLS[variant]} ${
        disabled ? "pointer-events-none opacity-40" : ""
      } ${className}`}
    >
      <LiquidCarveButton
        label={label || title || "action"}
        rounded={100}
        padding={dims.padding}
        fill={paint.fill}
        blob={{ color: paint.blob, size: dims.blob, smoothness: 58 }}
        textColor={paint.text}
        font={{
          fontFamily: BUTTON_FONT,
          fontWeight: paint.weight,
          fontSize: dims.fontSize,
          lineHeight: 1,
          letterSpacing: "0.01em",
        }}
        transition={{ type: "spring", stiffness: 170, damping: 18, mass: 0.9 }}
      >
        <span className="inline-flex items-center gap-1.5">{children}</span>
      </LiquidCarveButton>
    </span>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-chrome mb-1 block font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-slate-500">{hint}</span> : null}
    </label>
  );
}

/** Champs de saisie : verre creusé, liseré chromé, focus bleu/blanc. */
export const inputClass =
  "w-full rounded-lg border border-slate-100/15 bg-black/35 px-3 py-2.5 text-sm text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),inset_0_-1px_0_rgba(0,0,0,0.4)] backdrop-blur-md transition-colors placeholder-slate-600 focus:border-accent/70 focus:outline-none focus:ring-1 focus:ring-accent/50";

export function Modal({
  open,
  onClose,
  title,
  children,
  width = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={onClose} />
      <div className={`glass-strong glass-live relative w-full ${width} rounded-2xl`}>
        <div className="flex items-center justify-between border-b border-slate-100/12 px-5 py-3.5">
          <h2 className="text-chrome font-mono text-sm font-semibold uppercase tracking-[0.16em]">
            {title}
          </h2>
          <Button size="sm" variant="ghost" title="Fermer" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-slate-100/25 border-t-accent"
      style={{ width: size, height: size }}
    />
  );
}

/** HUD-style stat chip: chrome number + micro label, liquid glass shell. */
export function StatChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: "slate" | "red" | "amber" | "emerald";
}) {
  const tones = {
    slate: "text-chrome",
    // Ancien « red » → bordeaux ; ancien « emerald » → bleu/blanc animé.
    red: "text-red-300",
    amber: "text-amber-300",
    emerald: "text-accent-live",
  };
  const dots = {
    slate: "bg-slate-300",
    red: "bg-red-400 shadow-[0_0_10px_rgba(168,40,63,0.9)]",
    amber: "bg-amber-300 shadow-[0_0_10px_rgba(223,174,83,0.85)]",
    emerald: "dot-accent",
  };
  return (
    <div className="glass glass-sheen flex items-center gap-2 rounded-xl px-3 py-1.5">
      <span className={`h-1.5 w-1.5 rounded-full ${dots[tone]}`} />
      <div className="leading-none">
        <span className={`font-mono text-sm font-bold ${tones[tone]}`}>{value}</span>
        <span className="text-chrome ml-1.5 font-mono text-[9px] uppercase tracking-[0.16em]">
          {label}
        </span>
      </div>
    </div>
  );
}
