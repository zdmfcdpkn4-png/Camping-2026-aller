# Roadbook partagé — Montaigu → Argelès-Gazost

Roadbook interactif (carte, étapes, consignes, check-list bagages) dont le suivi est
**partagé en temps quasi réel entre tous les appareils** : chaque coche est horodatée,
le serveur fusionne item par item et la modification la plus récente gagne.

## Contenu du dépôt

| Fichier | Rôle |
|---|---|
| `index.html` | Frontend complet (carte Leaflet, roadbook, check-lists) |
| `api/sync.js` | Fonction serverless Vercel : fusion des états + lecture/écriture Redis |
| `package.json` | Minimal (`"type": "module"` pour la fonction) |

Aucune dépendance npm, aucun build : Vercel sert `index.html` en statique et
transforme `api/sync.js` en endpoint `/api/sync`.

## Déploiement en 5 étapes

1. **GitHub** — créer un dépôt et y pousser ces fichiers tels quels.
2. **Vercel** — *Add New… → Project* → importer le dépôt → *Framework preset : Other*
   → *Deploy*. Le site fonctionne déjà, mais la synchro affichera « hors ligne »
   tant que le stockage n'est pas branché.
3. **Stockage** — dans le projet Vercel : onglet *Storage* (ou *Marketplace*) →
   **Upstash** → créer une base **Redis** (plan gratuit) → la connecter au projet.
   L'intégration injecte automatiquement les variables d'environnement
   (`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`, ou `KV_REST_API_URL` /
   `KV_REST_API_TOKEN` selon le mode — le backend accepte les deux).
4. **Redéployer** — *Deployments → ⋯ → Redeploy* pour que les variables soient
   prises en compte.
5. **Personnaliser `TRIP`** — dans `index.html`, remplacer `"argeles-2026"` par une
   chaîne longue et aléatoire (ex. `"argeles-k3v9tqx27m"`). C'est la seule
   « clé d'accès » : quiconque connaît l'URL **et** cet identifiant lit et modifie
   le suivi. Pousser le commit : Vercel redéploie tout seul.

Test : ouvrir l'URL sur deux téléphones, cocher d'un côté, voir apparaître de
l'autre (à la synchro suivante, ≤ 12 s, ou immédiatement après une action).

## Fonctionnement

- Le client envoie tout son état à `POST /api/sync?trip=<id>` à chaque action et
  toutes les 12 s quand la page est visible ; il adopte l'état fusionné renvoyé.
- Fusion par horodatage **item par item** (`ts`), avec marqueur `resetAt` : la
  remise à zéro (double appui) efface pour tout le monde.
- Le serveur n'écrit dans Redis que si l'état a réellement changé (économise le
  quota gratuit ; ordre de grandeur largement suffisant pour un usage familial).

### Contrat API

```
GET  /api/sync?trip=<id>                 -> 200 { state }
POST /api/sync?trip=<id>  { state }      -> 200 { state fusionné }
                                            400 trip manquant · 413 état trop gros
                                            500 stockage non configuré · 502 Redis injoignable
```

## Limites assumées

- **Pas d'authentification** : la confidentialité repose sur l'URL + l'identifiant
  `TRIP` (d'où l'importance d'une valeur aléatoire). Ne rien y mettre de sensible.
- Conflit sur **le même item** dans la même seconde : le dernier horodatage gagne
  (dépend de l'horloge des téléphones, en pratique sans enjeu ici).
- CORS ouvert (`*`) pour pouvoir tester le fichier depuis n'importe où ;
  restreignez `Access-Control-Allow-Origin` à votre domaine si vous préférez.

## Développement local (facultatif)

```bash
npm i -g vercel
vercel link
vercel env pull .env.development.local
vercel dev
```
