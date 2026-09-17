/** Small shared UI primitives (dark SaaS style, emerald accents). */

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
    "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";
  const sizes = { sm: "px-2.5 py-1 text-xs", md: "px-3.5 py-2 text-sm" };
  const variants = {
    default:
      "bg-surface-overlay border border-surface-border text-slate-200 hover:border-slate-500 hover:bg-slate-700/40",
    primary:
      "bg-accent text-slate-950 hover:bg-accent-soft font-semibold shadow-glow hover:shadow-glow-sm",
    danger:
      "bg-red-500/10 border border-red-500/40 text-red-400 hover:bg-red-500/20",
    ghost: "text-slate-400 hover:text-slate-100 hover:bg-slate-700/40",
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
      <span className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-slate-500">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-md border border-surface-border bg-surface-raised px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40";

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
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={`relative w-full ${width} rounded-xl border border-surface-border bg-surface-raised shadow-[0_20px_60px_rgba(0,0,0,0.6),0_0_30px_rgba(16,185,129,0.06)]`}
      >
        <div className="flex items-center justify-between border-b border-surface-border px-5 py-3.5">
          <h2 className="font-mono text-sm font-semibold uppercase tracking-wider text-slate-100">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-500 hover:bg-slate-700/40 hover:text-slate-200"
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
      className="inline-block animate-spin rounded-full border-2 border-slate-600 border-t-accent"
      style={{ width: size, height: size }}
    />
  );
}

/** HUD-style stat chip: glowing mono number + micro label. */
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
    slate: "text-slate-100",
    red: "text-red-400",
    amber: "text-amber-400",
    emerald: "text-emerald-400",
  };
  const dots = {
    slate: "bg-slate-400",
    red: "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]",
    amber: "bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.8)]",
    emerald: "bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]",
  };
  return (
    <div className="flex items-center gap-2 rounded-lg border border-surface-border bg-surface-overlay/80 px-3 py-1.5 backdrop-blur">
      <span className={`h-1.5 w-1.5 rounded-full ${dots[tone]}`} />
      <div className="leading-none">
        <span className={`font-mono text-sm font-bold ${tones[tone]}`}>{value}</span>
        <span className="ml-1.5 font-mono text-[9px] uppercase tracking-widest text-slate-500">
          {label}
        </span>
      </div>
    </div>
  );
}