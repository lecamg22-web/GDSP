# Gentleman Drivers Project (GDSP)

Portail public de classements pour les championnats et opens **Assetto Corsa**
historiques de GDSP. Interface entièrement en français, consultable sans compte.

## Arborescence (justifiée)

```
server.js            Service unifié Render : API + SSR + statiques (PORT, 0.0.0.0)
backend/
  server.js          Entrée API seule, conservée pour le développement
  app.js             API REST Express (publique + admin Bearer) — createApp(store) testable
  lib/
    store.js         Persistance : MemoryStore (tests/local) ou PostgresStore Neon via HTTPS
                     (protocole SQL HTTP de Neon, bibliothèque standard uniquement).
                     Le frontend ne parle JAMAIS à la base, uniquement à cette API.
    anonymize.js     Pseudonymisation déterministe SHA-256 des GUID Steam (jamais exposés)
    points.js        Barème, pôle, coefficient, distance min., jokers
    penalties.js     Pénalités Commission -> reclassement automatique
    standings.js     Classement général d'un événement
    globalRating.js  Note GLOBAL Discord /100 (régularité, propreté, vitesse, résultats)
    importResult.js  Normalisation AssettoHosting, anti-doublons (date+type), PRACTICE/test écartés
    circuit.js       Construction d'une fiche circuit à partir des fichiers de mod
    ahServers.js     Scan des serveurs AssettoHosting
    auth.js          Login admin + jetons Bearer HMAC (ADMIN_USERNAME/ADMIN_PASSWORD)
frontend/
  server.js          Entrée frontend seul, conservée pour le développement
  app.js             SSR (accueil, /evenements/:slug, /global), SEO, sitemap, robots,
                     proxy /api/* uniquement en mode services séparés
  public/
    index.html       HTML/CSS (aucun framework, aucun build)
    site.js          TOUT le JavaScript front, vanilla, un seul fichier
tools/
  lib/               fastLane.js (binaire fast_lane.ai, courbure pleine résolution),
                     modFiles.js (surfaces.ini KEY=, overlays.ini secteurs), drive.js (Drive sans clé API)
  compact-fastlane.js, import-circuit-drive.js, import-results.js
tests/gdsp.test.js   node --test uniquement
render.yaml          Un seul service Render unifié (frontend + backend)
```

Une seule dépendance de production : `express` (voir `package.json`).
Tout le reste est en bibliothèque standard Node (`node:crypto`, `node:https`, `node:fs`).

## Commandes

| Commande | Effet |
|---|---|
| `npm install` | Installe l'unique dépendance (`express`) |
| `npm test` | Lance la suite `node --test tests/*.test.js` |
| `npm start` | Service unifié sur `PORT` (défaut 3000), sans `BACKEND_URL` |
| `npm run start:backend` | API seule sur `PORT` (défaut 4000) |
| `npm run start:frontend` | Site + proxy `/api/*` sur `PORT` (défaut 3000), `BACKEND_URL` requis en prod |
| `node tools/compact-fastlane.js <fast_lane.ai> [out.json]` | Régénère le JSON compact d'un tracé (~220 points à 0,1 m + virages en fraction de tour, détectés sur la ligne **pleine résolution**) |
| `node tools/import-results.js <slug> <fichier.json...>` | Import manuel unitaire ou en masse (env. `BACKEND_URL`, `ADMIN_TOKEN`) |
| `node tools/import-circuit-drive.js <slug> <url-dossier-drive> <M1> [libellé]` | Aperçu + (si `BACKEND_URL`/`ADMIN_TOKEN`) enregistrement d'une fiche circuit depuis un dossier Drive accessible par lien (y compris `resourcekey`) — **aucune clé API Google** |

## Serveurs AssettoHosting (import automatique)

Deux serveurs sont configurés par défaut (`backend/lib/ahServers.js`) :
`GDSP #1` https://fr2.assettohosting.com:50648/results (1 489 résultats) et
`GDSP #2` https://fr5.assettohosting.com:50145/results (221 résultats).
L'index `/results` est une page HTML paginée (`?page=n`, recherche Bleve
`?q=Type:RACE`) : le scan ne télécharge que les JSON RACE et QUALIFY via
`/results/download/<fichier>.json` (25/page, 4 pages par type par défaut),
les PRACTICE ne sont jamais téléchargés, et les doublons (date + type)
rendent les re-scans sans effet. **Un 3e serveur l'an prochain = zéro code** :
onglet admin « Serveurs AH », ou variable `AH_SERVER_URLS` (URL séparées par
des virgules). Format réel validé le 10/11/2026 sur les deux serveurs :
`Result` au singulier (l'ordre du tableau est le classement), temps toujours
en millisecondes, distance déduite de `NumLaps`, collisions imbriquées
`{Driver:{Guid}}` anonymisées à l'import.

## Import direct des championnats AssettoHosting

L'onglet **Imports** charge la liste HTML de `/championships` (par défaut GDSP #1), avec progression,
nombre de manches et d'inscrits. Après sélection, le backend télécharge uniquement l'URL
`/championship/<id>/export` correspondante et recherche récursivement les sessions RACE/QUALIFY dans
cette exportation complète. Elles sont normalisées, pseudonymisées et envoyées dans `pendingSessions` :
aucune publication n'a lieu sans validation dans **Commission**. Les inscrits et leurs GUID Steam ne
sont jamais persistés ; seules des métadonnées sûres du championnat (ID, nom, URL, progression) sont
associées à l'événement GDSP. Les doublons sont contrôlés contre les brouillons et les sessions publiées.

## Variables d'environnement

- Backend : `PORT`, `DATABASE_URL` (Neon/PostgreSQL ; absent = mémoire), `NEON_API_KEY` (optionnel),
  `ADMIN_USERNAME`, `ADMIN_PASSWORD`.
- Service unifié : `PORT`, `SITE_URL` (canonical/sitemap). `BACKEND_URL` est inutile.
- Frontend séparé (développement uniquement) : `PORT`, `BACKEND_URL`, `SITE_URL`.

## Règles métier implémentées et testées

- **Anonymisation** : GUID Steam `7656119...` → `pilote-<12 hex SHA-256>`, déterministe, jamais exposé.
- **Points** : échelle configurable, points de pôle, coefficient, distance minimale ; **jokers** = N plus
  mauvaises manches écartées.
- **GLOBAL Discord /100** : régularité « best minus average non-best » (1er tour et tours > +21 s exclus),
  propreté (contacts avec perte de temps + 1/cut), vitesse (meilleur tour du week-end Q+R), résultats après
  pénalités ; pondération demi-vie 90 jours, minimum 5 courses ; Débutant 0–40, Intermédiaire 41–60,
  Confirmé 61–80, Élite 81–100.
- **Circuits** : `surfaces.ini` lit `KEY=` (pas `[SURFACE_0]`) ; `overlays.ini` : N départs = N secteurs,
  le dernier se ferme sur la ligne d'arrivée (fraction 1, sans trou ni chevauchement).
- **Données absentes** : toujours « à confirmer » / « Date à confirmer » — aucune date, aucun vainqueur,
  aucun chrono inventé. Aucun libellé d'un championnat ne fuit sur un autre événement.
- **`.gitignore`** : motifs ancrés uniquement — un `lib/` non ancré avalerait `tools/lib/`.

## Administration (mot de passe, jeton Bearer)

### Validation par la Commission avant publication

Tout import RACE/QUALIFY — fichiers JSON, scan manuel ou import AssettoHosting — alimente
`data.pendingSessions`, une file privée accessible uniquement avec le jeton admin. Ces brouillons
ne sont pas renvoyés par l'API publique et ne participent ni aux résultats, ni aux statistiques,
ni aux classements. Dans **Commission**, l'administrateur peut corriger circuit, date, type,
positions, pilotes, temps, pénalités et disqualifications, enregistrer, écarter ou publier chaque
session. **Publier et calculer** reclasse les résultats avec les pénalités, déplace la session vers
`data.sessions` et rend immédiatement effectifs les classements général et GLOBAL. Les doublons
(date + type) sont détectés à la fois contre les brouillons et les sessions déjà publiées.

Onglets fonctionnels dans `site.js` : **Imports** (fichier JSON unitaire ou en masse,
scan AssettoHosting), **Manches** (liste/suppression), **Commission** (pénalités en
secondes — les classements se recalculent, la clé de pénalité est la date de course),
**Pilotes** (noms affichés via `manualDrivers`), **Données** (export/réimport JSON,
suppression), **Événements** (création), **Serveurs AH** (configuration + scan),
**Circuits** (aperçu Drive puis enregistrement dans l'événement courant),
**Global** (exclusions du classement Discord, persistées côté backend).
Côté public, chaque pilote a un profil individuel (courses, meilleur résultat).

## Déploiement Render

Un seul service `gdsp-frontend` exécute `node server.js` (voir `render.yaml`) avec `DATABASE_URL`,
`ADMIN_*` et `SITE_URL`. L'API, les pages SSR, l'application et les fichiers statiques partagent le
même processus : il n'y a plus de proxy `BACKEND_URL` ni de second service à réveiller. Après validation
du déploiement unifié, l'ancien service `gdsp-backend` peut être suspendu dans Render pour éviter de
consommer inutilement le quota gratuit.
