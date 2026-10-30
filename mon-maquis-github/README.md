# Mon Maquis

Application web (PWA) de gestion pour maquis et bars, vendue sur Chariow. Fonctionne hors ligne.

- Application : https://mon-maquis-app.pages.dev (hébergée sur Cloudflare Pages)
- Page de vente : https://xlzrpfoi.mychariow.store/mon-maquis
- Serveur de licences : https://mon-maquis-licences.jardelehouman.workers.dev (Cloudflare Worker + KV)

## Contenu
- `site/` : le dossier publié (index.html, sw.js, _headers, manifest, icônes)
- `serveur-licences/worker.js` : serveur de licences
- `docs/` : guides (sécurité, licences)

## Publier une mise à jour
1. Modifier `site/index.html`.
2. Si le contenu change, augmenter la version dans `site/sw.js` (`mon-maquis-v8` -> `v9`).
3. Cloudflare > Workers & Pages > projet `mon-maquis-app` > New deployment, puis glisser le dossier `site/`.

## Règles
- Ne jamais mettre ici : SECRET, ADMIN_TOKEN, codes de licence (`codes.txt`).
