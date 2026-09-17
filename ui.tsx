/** Small shared UI primitives — liquid glass, chrome text, animated blue/white accent. */

import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect } from "react";

export function Button({
  children,
  onClick,
  variant = "default",
  size = "md",
  disabled,
  type = "button",
  className = "",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "danger" | "ghost";
  size?: "sm" | "md";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
  title?: string;
}) {
  const base =
    "relative inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70";
  /**
   * Cibles tactiles confortables (≥ 36 px de haut, la taille `md` atteint les
   * 40 px avec la bordure) — le verre reste lisible au doigt.
   */
  const sizes = { sm: "px-3 py-1.5 text-xs min-h-[30px]", md: "px-4 py-2.5 text-sm min-h-[40px]" };
  const variants = {
    default:
      "glass glass-sheen text-slate-100 hover:border-slate-300/40 hover:shadow-glow-sm",
    // Accent VIVANT : dégradé bleu ⇄ blanc animé (remplace l'ancien vert).
    primary:
      "accent-live border border-white/25 font-semibold shadow-glow shadow-glow hover:brightness-110",
    // Bordeaux classe (remplace le rouge vif).
    danger:
      "glass border-red-400/45 text-red-300 hover:border-red-300/60 hover:bg-red-500/15 hover:shadow-glow-red",
    ghost: "text-slate-300 hover:text-white hover:bg-slate-100/10",
  };
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
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
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-300 transition-colors hover:bg-slate-100/10 hover:text-white"
            aria-label="Fermer"
          >
            <X size={16} />
          </button>
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
