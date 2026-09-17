# Fonction Edge Supabase — « groq »

Passerelle unique vers l'API Groq. **Toutes** les analyses de l'application passent
par elle : la clé `GROQ_API_KEY` est stockée dans les **secrets Supabase** et
n'est jamais envoyée au navigateur.

## Ce que la fonction garantit

| Exigence | Implémentation |
|---|---|
| Clé jamais côté front | Lue via `Deno.env.get("GROQ_API_KEY")`, uniquement dans la fonction |
| Timeout 15 s par appel | `AbortController` + `setTimeout(15 000)` |
| 3 tentatives | 1 essai + 3 relances, délais **1 s → 2 s → 4 s** |
| JSON invalide | Validation du JSON avant réponse, puis nouvelle tentative |
| Erreur compréhensible | Message français (`Oups, l'analyse a échoué…`) + détail technique |
| Coût maîtrisé | `max_tokens` plafonné à 3 000, `temperature` 0.3 |
| Modèle retiré | Repli automatique si le modèle demandé renvoie un 404, puis **mémorisation** du modèle qui a répondu (plus de 404 répétés) |
| Affichage progressif | Mode `stream: true` : le flux SSE de Groq est relayé tel quel au navigateur (`text/event-stream`) |
| Modèle principal | `llama-3.3-70b-versatile` (repli `gpt-oss`) + `llama-3.1-8b-instant` pour les étapes simples |
| Erreurs préservées | Le message français de la fonction remonte intact jusqu'à l'interface, avec un bouton **Réessayer** |

## Déploiement

```bash
# 1. Installer la CLI puis se connecter
npm install -g supabase
supabase login

# 2. Lier le projet (remplacer par votre référence de projet)
supabase link --project-ref <votre-ref>

# 3. Enregistrer la clé Groq dans les SECRETS (jamais dans un fichier du dépôt)
supabase secrets set GROQ_API_KEY=gsk_votre_cle

# 4. Déployer la fonction
supabase functions deploy groq --no-verify-jwt
```

URL publique obtenue :

```
https://<votre-ref>.supabase.co/functions/v1/groq
```

## Côté application

Deux façons de la brancher :

1. **Build** — dans `.env.local` (copie de `.env.example`) :
   ```dotenv
   VITE_SUPABASE_FUNCTIONS_URL=https://<votre-ref>.supabase.co/functions/v1/groq
   ```
2. **Sans rebuild** — ⚙ Réglages → *Passerelle d'analyse* → coller l'URL.

Tant qu'aucune passerelle n'est configurée, l'application **refuse tout appel
direct** et affiche un message de configuration clair : la clé ne doit pas
circuler dans le navigateur. Pour un développement local sans fonction déployée,
il faut autoriser explicitement la clé locale (`VITE_ALLOW_DIRECT_AI_KEY=true`
dans `.env`, jamais en production).

## Test manuel

```bash
curl -X POST "https://<votre-ref>.supabase.co/functions/v1/groq" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"system","content":"Réponds en JSON"},{"role":"user","content":"Donne un objet {\"ok\":true}"}],"json_mode":true,"max_tokens":50}'
```

Réponse attendue : `{"ok":true,"content":"{...}","model":"..."}` — et en cas
d'échec : `{"ok":false,"error":"Oups, l'analyse a échoué…","detail":"…"}`.

### Mode streaming

Avec `"stream": true`, la fonction renvoie un flux `text/event-stream` : chaque
ligne `data: {...}` contient un fragment `choices[0].delta.content` de Groq, et le
navigateur affiche le texte au fur et à mesure. Le backoff 1 s / 2 s / 4 s
s'applique tant qu'aucune donnée n'a commencé à circuler ; si le flux casse en
cours de route, un événement `data: {"error":"…"}` est envoyé et le client
retombe automatiquement sur un appel classique.
