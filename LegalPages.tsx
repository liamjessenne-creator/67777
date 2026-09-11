/**
 * Legal pages — Mentions légales, Politique de confidentialité (RGPD) and
 * CGU. Plain prose, no AI, no tracking: static informational content.
 */

import { ArrowLeft, Scale } from "lucide-react";
import type { ReactNode } from "react";
import type { LegalPage } from "./types";

interface Props {
  page: LegalPage;
  onBack: () => void;
}

const PAGES: Record<LegalPage, { title: string; updated: string; body: ReactNode }> = {
  mentions: {
    title: "Mentions légales",
    updated: "11 septembre 2026",
    body: (
      <>
        <Section title="Éditeur de l'application">
          <p>
            <strong>GeoLead Finder AI</strong> est un outil open-source de prospection
            commerciale, publié à titre personnel par l'exploitant du dépôt GitHub{" "}
            <a href="https://github.com/liamjessenne-creator/67777" target="_blank" rel="noreferrer noopener">
              liamjessenne-creator/67777
            </a>
            . Contact : via la page « Issues » du dépôt GitHub.
          </p>
          <p>
            Responsable de publication : l'exploitant du dépôt susmentionné.
            Hébergement des sources : GitHub, Inc., 88 Colin P. Kelly Jr. Street,
            San Francisco, CA 94107, États-Unis. Toute instance de l'application est
            hébergée par la plateforme sur laquelle elle est déployée (par ex. Vercel,
            Netlify) ou exécutée localement par l'utilisateur.
          </p>
        </Section>
        <Section title="Nature du service">
          <p>
            GeoLead Finder AI est un <strong>outil d'aide à la prospection</strong> destiné
            aux prestataires de services numériques. Il agrège des données
            publiquement accessibles afin d'identifier des entreprises dont la
            présence numérique est faible, et génère des audits commerciaux assistés
            par intelligence artificielle.
          </p>
        </Section>
        <Section title="Propriété intellectuelle">
          <p>
            Le code source est publié sous <a href="https://github.com/liamjessenne-creator/67777/blob/main/LICENSE" target="_blank" rel="noreferrer noopener">licence MIT</a>.
            Les données cartographiques proviennent d'
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer noopener">
              OpenStreetMap
            </a>{" "}
            et sont réutilisées conformément à la licence <em>Open Database License</em>
            (ODbL) : © contributeurs d'OpenStreetMap. Les résultats générés par
            l'intelligence artificielle sont produits par le modèle configuré par
            l'utilisateur (Groq, DeepSeek ou tout endpoint compatible OpenAI) et
            restent fournis « en l'état ».
          </p>
        </Section>
        <Section title="Limitation de responsabilité">
          <p>
            L'outil est fourni « en l'état », sans garantie d'exactitude, de
            complétude ou d'actualité des données. Les informations issues
            d'OpenStreetMap peuvent être incomplètes ou obsolètes ; les sites web
            « découverts » par l'IA sont des <strong>probabilités, pas des certitudes</strong>.
            L'utilisateur demeure seul responsable de l'usage qu'il fait des
            résultats, de la véracité des démarches entreprises et du respect de la
            réglementation applicable à ses actions commerciales.
          </p>
        </Section>
      </>
    ),
  },
  privacy: {
    title: "Politique de confidentialité (RGPD)",
    updated: "11 septembre 2026",
    body: (
      <>
        <Section title="Principe : zéro serveur, zéro tracking">
          <p>
            GeoLead Finder AI ne possède <strong>aucun serveur</strong>, aucun compte
            utilisateur, aucun cookie publicitaire et <strong>aucun outil de
            traçage</strong>. L'application est une page web statique : tout ce que
            vous faites reste sur votre appareil.
          </p>
        </Section>
        <Section title="Données stockées localement (localStorage)">
          <p>
            L'application enregistre dans le stockage local de votre navigateur :
            vos paramètres de connexion API (clé, endpoint, modèle), vos filtres,
            l'historique de scans et les prospects trouvés. Ces données
            <strong> ne quittent jamais votre navigateur</strong> et vous pouvez les
            effacer à tout moment (réinitialisation du stockage du site dans votre
            navigateur, ou bouton de réinitialisation dans l'outil).
          </p>
        </Section>
        <Section title="Services tiers appelés">
          <ul>
            <li>
              <strong>OpenStreetMap / Overpass / Nominatim / Photon</strong> — recherche
              de villes et établissements (données publiques, aucune donnée
              personnelle transmise).
            </li>
            <li>
              <strong>Votre fournisseur d'IA</strong> (par ex. Groq) — les prompts
              d'audit contiennent le nom, la catégorie et la situation de
              l'établissement analysé, mais <strong>jamais vos données personnelles</strong>.
              Ces requêtes sont couvertes par la politique de confidentialité du
              fournisseur choisi.
            </li>
            <li>
              <strong>Google Places API</strong> (facultatif, désactivé par défaut) —
              uniquement si vous saisissez votre propre clé.
            </li>
          </ul>
        </Section>
        <Section title="Données personnelles des commerçants prospectés">
          <p>
            Les établissements listés proviennent de sources ouvertes (OpenStreetMap).
            Si vous les contactez, <strong>vous</strong> êtes responsable du traitement
            de leurs coordonnées au sens du RGPD : intérêt légitime à documenter,
            information des personnes, respect de leur droit d'opposition, et
            conformité aux règles de prospection commerciale (CNIL / article L.34-5
            du code des postes et des communications électroniques pour les
            démarches électroniques).
          </p>
        </Section>
        <Section title="Vos droits">
          <p>
            N'ayant aucune donnée personnelle sur nos serveurs, nous ne pouvons pas
            répondre aux demandes d'accès, de rectification ou de suppression :
            celles-ci s'exercent directement sur votre navigateur (effacement du
            localStorage) ou auprès des services tiers susmentionnés.
          </p>
        </Section>
      </>
    ),
  },
  terms: {
    title: "Conditions générales d'utilisation (CGU)",
    updated: "11 septembre 2026",
    body: (
      <>
        <Section title="1. Objet">
          <p>
            Les présentes conditions régissent l'utilisation de l'application
            GeoLead Finder AI, outil d'aide à la prospection commerciale combinant
            données cartographiques publiques et analyse par intelligence
            artificielle. En utilisant l'application, vous acceptez ces conditions
            sans réserve.
          </p>
        </Section>
        <Section title="2. Utilisation autorisée">
          <ul>
            <li>
              Prospection commerciale loyale auprès d'établissements identifiés :
              messages personnalisés, non trompeurs, avec information claire sur
              l'identité de l'expéditeur et un moyen simple de refuser tout contact
              ultérieur.
            </li>
            <li>
              Respect de la réglementation applicable : RGPD, code de la
              consommation, code des postes et des communications électroniques
              (interdiction de démarchage électronique sans consentement pour les
              particuliers, opt-out obligatoire pour les professionnels).
            </li>
          </ul>
        </Section>
        <Section title="3. Usages interdits">
          <ul>
            <li>Spam de masse, envois automatisés sans personnalisation ni opt-out.</li>
            <li>Usurpation d'identité ou faux prétextes (« j'ai audit » sans l'avoir fait).</li>
            <li>
              Revente ou republication des données compilées en tant que base de
              données sans respecter la licence ODbL d'OpenStreetMap.
            </li>
            <li>Toute activité illégale, discriminatoire ou portant atteinte aux personnes.</li>
          </ul>
        </Section>
        <Section title="4. Données et IA">
          <p>
            Les résultats de l'IA sont <strong>indicatifs</strong>. Il incombe à
            l'utilisateur de vérifier chaque information (site web, avis, numéro de
            téléphone) avant tout usage commercial. L'éditeur ne garantit ni
            l'exactitude des scores, ni la validité des liens « découverts », ni la
            disponibilité des API publiques utilisées.
          </p>
        </Section>
        <Section title="5. Responsabilité">
          <p>
            L'application est fournie « en l'état » sous licence MIT, sans garantie
            d'aucune sorte. L'éditeur ne saurait être tenu responsable des dommages
            directs ou indirects résultant de l'utilisation de l'outil ou des
            démarches commerciales engagées à partir de ses résultats.
          </p>
        </Section>
        <Section title="6. Évolution des conditions">
          <p>
            La version applicable est celle publiée dans le dépôt GitHub au moment
            de votre utilisation. Des mises à jour peuvent intervenir à tout moment ;
            il vous appartient de les consulter.
          </p>
        </Section>
      </>
    ),
  },
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-emerald-400">
        {title}
      </h2>
      <div className="space-y-2 text-[13.5px] leading-relaxed text-slate-300 [&_a]:text-accent [&_a:hover]:underline [&_li]:pl-1 [&_p]:text-slate-300 [&_strong]:text-slate-100 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

export function LegalPageView({ page, onBack }: Props) {
  const p = PAGES[page];
  return (
    <div className="bg-grid min-h-full">
      <header className="border-b border-surface-border bg-surface-raised/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-3">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-md border border-surface-border px-2.5 py-1.5 text-xs text-slate-300 transition-colors hover:border-accent/50 hover:text-accent"
          >
            <ArrowLeft size={13} /> Retour
          </button>
          <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
            <Scale size={12} /> GeoLead Finder AI
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-50">{p.title}</h1>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-slate-500">
          Dernière mise à jour : {p.updated}
        </p>
        <div className="mt-8 rounded-xl border border-surface-border bg-surface-raised p-6 sm:p-8">
          {p.body}
        </div>

        <nav className="mt-8 flex flex-wrap gap-4 text-xs text-slate-500">
          <a href="#/mentions-legales" className="hover:text-accent">Mentions légales</a>
          <a href="#/confidentialite" className="hover:text-accent">Confidentialité</a>
          <a href="#/cgu" className="hover:text-accent">CGU</a>
        </nav>
      </main>
    </div>
  );
}
