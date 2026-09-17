/**
 * Link Preview — Originkit (composant fourni), avec corrections d'usage.
 *
 * Ce qui a été AMÉLIORÉ après vérification sur de vrais sites (le composant
 * « marchait moyen ») :
 *
 *  1. IMAGE UTILE — l'aperçu d'origine demandait l'image de partage du site :
 *     pour bigfernand.com l'og:image fait 96×96 px (étirée dans une carte de
 *     344×172, donc floue), pour 100percentcrousti.com le service renvoie
 *     `{"status":"fail"}` (image cassée) et pour brasseriedelavillette.fr un SVG
 *     (un logo). On affiche désormais un **cloqué réel de la page** en JPEG léger
 *     (voir `thumbnails.ts`), avec préchauffage au survol et cache.
 *  2. PLUS DE CADRE BLANC VIDE — pendant le chargement : squelette + nom du
 *     domaine ; en cas d'échec : carte « aperçu indisponible » avec le domaine.
 *     La carte passe aussi du blanc au **verre fumé chromé** du reste du site.
 *  3. PLUS DE ROGNAGE — l'aperçu est rendu dans un PORTAIL en position fixe et
 *     recalé dans la fenêtre (bascule au-dessus ou au-dessous du lien, jamais
 *     hors écran). Avant, il était coupé par le conteneur défilant du tableau
 *     et par le tiroir d'analyse.
 *  4. ACCESSIBLE — la carte s'ouvre aussi au FOCUS clavier (Échap pour fermer),
 *     pas uniquement au survol de la souris.
 *
 * Le comportement d'origine est conservé : lien souligné, apparition au ressort,
 * léger décalage horizontal qui suit la souris, mêmes props, même export.
 */

const useIsStaticRenderer = () => false
import {
    AnimatePresence,
    motion,
    useMotionValue,
    useSpring,
    useTransform,
} from "framer-motion"
import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { CSSProperties } from "react"
import { Globe, Loader2 } from "lucide-react"
import { markThumb, preloadShot, shotUrl, siteHost, thumbStatus } from "./thumbnails"

/** Espace entre le lien et la carte. */
const GAP = 14
/** Marge minimale conservée par rapport aux bords de la fenêtre. */
const EDGE = 12
/** z-index : au-dessus du tiroir (1000) et de la modale, comme un vrai tooltip. */
const Z = 1400

interface ImageValue {
    src: string
    srcSet?: string
    alt?: string
}

interface LinkPreviewProps {
    title: string
    link?: string
    imageMode: "original" | "custom"
    customImage: ImageValue
    previewWidth: number
    previewHeight: number
    radius: number
    shadow: boolean
    shadowColor: string
    textColor: string
    underlineColor: string
    font: any
    style?: CSSProperties
}

function __OriginkitBase_LinkPreview(props: LinkPreviewProps) {
    props = { ...COMPONENT_DEFAULTS, ...props }
    const {
        title = "Lander Studio",
        link = "https://lander.studio/",
        imageMode = "original",
        customImage,
        previewWidth = 520,
        previewHeight = 300,
        radius = 0,
        shadow = true,
        shadowColor = "rgba(0,0,0,0.30)",
        textColor = "#FFFFFF",
        underlineColor = "#FFFFFF",
        font,
        style,
    } = props

    const isStatic = useIsStaticRenderer()
    const [open, setOpen] = useState(false)
    const containerRef = useRef<HTMLSpanElement>(null)
    const cardRef = useRef<HTMLDivElement>(null)

    /**
     * `custom` garde l'image fournie par l'appelant ; `original` (mode d'origine)
     * passe par notre résolveur : cloqué réel + cache.
     */
    const isCustom = imageMode === "custom" && Boolean(customImage?.src)
    const imgSrc = isCustom ? customImage?.src : shotUrl(link)
    const imgSrcSet = isCustom ? customImage?.srcSet : undefined

    // État de chargement : un échec déjà connu n'est pas retenté en boucle, mais
    // un nouveau survol relance une tentative discrète en arrière-plan.
    const [state, setState] = useState<"loading" | "ready" | "failed">(
        !isCustom && thumbStatus(link) === "ko" ? "failed" : "loading",
    )

    const x = useMotionValue(0)
    const springX = useSpring(x, { stiffness: 120, damping: 16, mass: 0.6 })
    const translateX = useTransform(springX, [0, 1], [-50, 50])

    const onMove = (e: React.MouseEvent) => {
        const el = containerRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const ratio = (e.clientX - rect.left) / Math.max(1, rect.width)
        x.set(Math.max(0, Math.min(1, ratio)))
    }

    /** Position de la carte, recalée dans la fenêtre (portail en `fixed`). */
    const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
    const place = useCallback(() => {
        const el = containerRef.current
        if (!el) return
        const r = el.getBoundingClientRect()
        const vw = window.innerWidth
        const vh = window.innerHeight
        const width = Math.min(previewWidth, vw - EDGE * 2)
        const left = Math.max(EDGE, Math.min(vw - width - EDGE, r.left + r.width / 2 - width / 2))
        // Au-dessus du lien s'il y a la place, sinon en dessous.
        const above = r.top - previewHeight - GAP
        const top =
            above >= EDGE
                ? above
                : Math.min(r.bottom + GAP, Math.max(EDGE, vh - previewHeight - EDGE))
        setPos({ left, top })
    }, [previewWidth, previewHeight])

    // La carte suit le lien quand le tableau ou le tiroir défilent.
    useEffect(() => {
        if (!open || isStatic) return
        place()
        const onScroll = () => {
            if (cardRef.current) place()
        }
        window.addEventListener("scroll", onScroll, true)
        window.addEventListener("resize", onScroll)
        return () => {
            window.removeEventListener("scroll", onScroll, true)
            window.removeEventListener("resize", onScroll)
        }
    }, [open, isStatic, place])

    const show = () => {
        if (isStatic) return
        setOpen(true)
        place()
        if (!isCustom) {
            preloadShot(link)
            if (state === "failed" && thumbStatus(link) === "ok") setState("loading")
        }
    }
    const hide = () => setOpen(false)

    const failed = state === "failed"
    const width = pos ? Math.min(previewWidth, window.innerWidth - EDGE * 2) : previewWidth

    const card = (
        <AnimatePresence>
            {open && (
                <motion.div
                    ref={cardRef}
                    initial={{ opacity: 0, y: 14, scale: 0.92 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.96 }}
                    transition={{
                        type: "spring",
                        stiffness: 260,
                        damping: 22,
                    }}
                    style={{
                        position: "fixed",
                        left: pos?.left ?? 0,
                        top: pos?.top ?? 0,
                        x: translateX,
                        width,
                        height: previewHeight,
                        borderRadius: radius,
                        overflow: "hidden",
                        // Verre fumé chromé : cohérent avec l'interface (l'original
                        // affichait un cadre BLANC au milieu d'un site sombre).
                        background: "rgba(8, 11, 16, 0.82)",
                        backdropFilter: "blur(18px) saturate(150%)",
                        WebkitBackdropFilter: "blur(18px) saturate(150%)",
                        boxShadow: shadow
                            ? `0 22px 48px ${shadowColor}, 0 2px 8px ${shadowColor}, inset 0 1px 0 rgba(255,255,255,0.14)`
                            : "none",
                        border: "1px solid rgba(222, 233, 244, 0.22)",
                        pointerEvents: "none",
                        zIndex: Z,
                    }}
                >
                    {!failed && (
                        <img
                            src={imgSrc}
                            srcSet={imgSrcSet}
                            alt={title}
                            loading="eager"
                            decoding="async"
                            onLoad={() => {
                                setState("ready")
                                if (!isCustom) markThumb(link, "ok")
                            }}
                            onError={() => {
                                setState("failed")
                                if (!isCustom) markThumb(link, "ko")
                            }}
                            style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                                display: "block",
                                // Fondu à l'arrivée : plus de « pop » brutal.
                                opacity: state === "ready" ? 1 : 0,
                                transition: "opacity 0.35s ease",
                            }}
                            draggable={false}
                        />
                    )}

                    {/* Squelette de chargement : on annonce ce qui arrive. */}
                    {state === "loading" && !failed && (
                        <div className="thumb-skeleton absolute inset-0 flex flex-col items-center justify-center gap-2">
                            <Loader2 size={16} className="animate-spin text-accent" />
                            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">
                                chargement de l'aperçu…
                            </span>
                        </div>
                    )}

                    {/* Repli propre : jamais de cadre blanc vide. */}
                    {failed && (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 px-4 text-center">
                            <Globe size={18} className="text-accent" />
                            <span className="text-chrome font-mono text-[11px] font-semibold">
                                {siteHost(link)}
                            </span>
                            <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                                aperçu indisponible
                            </span>
                        </div>
                    )}

                    {/* Bandeau bas : le domaine, comme une barre d'onglet. */}
                    <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 border-t border-white/12 bg-black/55 px-2.5 py-1.5 backdrop-blur-md">
                        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                        <span className="truncate font-mono text-[10px] text-slate-300">
                            {siteHost(link)}
                        </span>
                        <span className="ml-auto shrink-0 font-mono text-[10px] text-slate-500">
                            aperçu du site
                        </span>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    )

    return (
        <span
            ref={containerRef}
            style={{
                position: "relative",
                display: "inline-block",
                width: "auto",
                ...font,
                // FIX (TypeScript strict) : la prop `style` était déclarée mais
                // jamais appliquée — elle va sur le conteneur (largeur, troncature).
                ...style,
            }}
            onMouseEnter={isStatic ? undefined : show}
            onMouseLeave={isStatic ? undefined : hide}
            onMouseMove={isStatic ? undefined : onMove}
            // FIX (accessibilité) : le clavier ouvre le même aperçu.
            onFocus={isStatic ? undefined : show}
            onBlur={isStatic ? undefined : hide}
            onKeyDown={
                isStatic
                    ? undefined
                    : (e: React.KeyboardEvent) => {
                          if (e.key === "Escape") hide()
                      }
            }
        >
            <a
                href={link}
                target="_blank"
                rel="noreferrer"
                style={{
                    color: textColor,
                    textDecoration: "underline",
                    textDecorationColor: underlineColor,
                    textUnderlineOffset: "0.18em",
                    textDecorationThickness: "1.5px",
                    whiteSpace: "nowrap",
                    cursor: "pointer",
                    ...font,
                }}
            >
                {title}
            </a>

            {/* Rendu hors du conteneur : aucun parent défilant ne peut le rogner. */}
            {typeof document !== "undefined" ? createPortal(card, document.body) : null}
        </span>
    )
}

const COMPONENT_DEFAULTS = {
    title: "framer.com",
    link: "https://framer.com",
    imageMode: "original",
    previewWidth: 280,
    previewHeight: 174,
    radius: 14,
    shadow: true,
    shadowColor: "rgba(0,0,0,0.30)",
    textColor: "#111111",
    underlineColor: "rgba(17,17,17,0.35)",
    font: {
        fontFamily: "Inter",
        variant: "Bold",
        fontSize: "44px",
        letterSpacing: "-0.02em",
        lineHeight: "1.2em",
    } as any,
}

const __originkitPresetProps = {
  "previewWidth": 344,
  "previewHeight": 172
};

export default function LinkPreview(props: Record<string, unknown>) {
  // FIX (TypeScript strict uniquement) : preset typé puis surchargé par `props`.
  const merged = { ...__originkitPresetProps, ...props } as unknown as LinkPreviewProps;
  return <__OriginkitBase_LinkPreview {...merged} />;
}

/**
 * Vignette de site à afficher DANS la page (et non en survol) : c'est la seule
 * façon de montrer l'aperçu sur téléphone, où il n'y a pas de survol. Utilisée
 * par la fiche de prospection, avec le même cache que l'aperçu flottant.
 */
export function SiteShot({
    site,
    width = 640,
    height = 360,
    className = "",
}: {
    site: string;
    width?: number;
    height?: number;
    className?: string;
}) {
    const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
    useEffect(() => {
        setState("loading");
        // Réinitialise le verdict « ko » : un site peut très bien répondre
        // maintenant alors qu'il était injoignable au premier essai.
        preloadShot(site);
    }, [site]);

    return (
        <a
            href={site}
            target="_blank"
            rel="noreferrer noopener"
            className={`glass glass-sheen group relative block overflow-hidden rounded-xl ${className}`}
            style={{ aspectRatio: `${width} / ${height}` }}
            title={`${site} — ouvrir dans un nouvel onglet`}
            onPointerEnter={() => preloadShot(site)}
        >
            {state !== "failed" ? (
                <img
                    src={shotUrl(site)}
                    alt={`Aperçu de ${siteHost(site)}`}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                    style={{ opacity: state === "ready" ? 1 : 0, transition: "opacity 0.4s ease" }}
                    onLoad={() => {
                        setState("ready");
                        markThumb(site, "ok");
                    }}
                    onError={() => {
                        setState("failed");
                        markThumb(site, "ko");
                    }}
                    draggable={false}
                />
            ) : null}
            {state !== "ready" ? (
                <div className="thumb-skeleton absolute inset-0 flex flex-col items-center justify-center gap-1.5">
                    <Globe size={16} className={state === "failed" ? "text-accent" : "animate-pulse text-slate-500"} />
                    <span className="text-chrome font-mono text-[10px]">{siteHost(site)}</span>
                    <span className="text-[9px] uppercase tracking-[0.16em] text-slate-500">
                        {state === "failed" ? "aperçu indisponible — cliquez pour ouvrir" : "chargement de l'aperçu…"}
                    </span>
                </div>
            ) : null}
            <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 border-t border-white/12 bg-black/60 px-2 py-1 backdrop-blur-md">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                <span className="truncate font-mono text-[10px] text-slate-300">{siteHost(site)}</span>
                <span className="ml-auto font-mono text-[9px] text-slate-500">ouvrir ↗</span>
            </span>
        </a>
    );
}
