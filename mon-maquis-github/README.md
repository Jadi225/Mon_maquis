# Mon Maquis

Application web (PWA) de gestion pour maquis et bars, vendue sur Chariow. Fonctionne hors ligne.

- `site/` : le dossier publié sur Netlify (index.html, sw.js, _headers, manifest, icônes)
- `serveur-licences/worker.js` : serveur de licences (Cloudflare Worker + KV)
- `docs/` : guides (sécurité, licences)

## Publier une mise à jour
1. Modifier `site/index.html`.
2. Si le fichier de mise en cache change, augmenter la version dans `site/sw.js` (`mon-maquis-v8` -> `v9`).
3. Glisser le dossier `site/` dans Netlify > Deploys.

## Règles
- Ne jamais mettre ici : SECRET, ADMIN_TOKEN, codes de licence (`codes.txt`).
