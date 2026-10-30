/*
  MON MAQUIS : serveur de licences (Cloudflare Worker + KV)

  Rôle : vérifier qu'un code d'activation est authentique (signé avec ta clé secrète),
  l'attacher à 2 téléphones au maximum, et te laisser gérer les codes depuis /admin.

  Réglages à créer dans Cloudflare (voir le guide) :
    - KV namespace lié sous le nom  LIC
    - Secret  SECRET       : longue phrase aléatoire. NE JAMAIS LA CHANGER après avoir vendu des codes.
    - Secret  ADMIN_TOKEN  : mot de passe du panneau /admin
    - Variable (facultatif)  MAX_DEVICES : nombre de téléphones par code (2 par défaut)
*/

const ALPHA = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // sans I, L, O, U : pas de confusion à la saisie
const enc = new TextEncoder();

function b32(bytes) {
  let out = "", bits = 0, val = 0;
  for (const b of bytes) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += ALPHA[(val >>> (bits - 5)) & 31]; bits -= 5; }
    val &= (1 << bits) - 1;
  }
  return out;
}

async function tagOf(id, secret) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode("MQ1:" + id)));
  return b32(sig.slice(0, 5)); // 40 bits = 8 caractères
}

function normCode(s) {
  return String(s || "").toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}

function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function isValid(code, secret) {
  if (code.length !== 16) return false;
  for (const ch of code) if (!ALPHA.includes(ch)) return false;
  return same(await tagOf(code.slice(0, 8), secret), code.slice(8));
}

async function newCode(secret) {
  const id = b32(crypto.getRandomValues(new Uint8Array(5)));
  return id + (await tagOf(id, secret));
}

function pretty(code) { return code.match(/.{4}/g).join("-"); }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400"
};
const SEC = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
const wait = ms => new Promise(r => setTimeout(r, ms));
/* cors=false pour /admin : le panneau est sur la même adresse, aucun autre site n'a besoin d'y accéder */
function json(obj, status = 200, cors = true) {
  return new Response(JSON.stringify(obj), { status, headers: { ...(cors ? CORS : {}), ...SEC, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

async function readRec(env, id) { return await env.LIC.get("c:" + id, "json"); }
async function writeRec(env, id, rec) {
  await env.LIC.put("c:" + id, JSON.stringify(rec), { metadata: { n: rec.devs.length, r: !!rec.revoked, t: rec.t } });
}

async function activate(env, body, verifyOnly) {
  const code = normCode(body.code), dev = String(body.device || "");
  if (!/^[0-9a-f]{16,64}$/.test(dev)) return { ok: false, err: "appareil" };
  if (!(await isValid(code, env.SECRET))) { await wait(400); return { ok: false, err: "invalide" }; } /* freine les essais au hasard */
  const id = code.slice(0, 8), max = parseInt(env.MAX_DEVICES || "2", 10) || 2;
  let rec = await readRec(env, id);
  if (rec && rec.revoked) return { ok: false, err: "revoque" };
  if (verifyOnly) {
    if (!rec) return { ok: false, err: "invalide" };
    return rec.devs.includes(dev) ? { ok: true } : { ok: false, err: "utilise" };
  }
  if (!rec) rec = { devs: [], t: Date.now() };
  if (rec.devs.includes(dev)) return { ok: true };
  if (rec.devs.length >= max) return { ok: false, err: "utilise" };
  rec.devs.push(dev);
  await writeRec(env, id, rec);
  return { ok: true };
}

async function admin(env, req) {
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 16) return json({ ok: false, err: "ADMIN_TOKEN absent ou trop court (16 caractères minimum) dans les réglages du Worker." }, 503, false);
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
  if (!same(auth, env.ADMIN_TOKEN)) { await wait(1000); return json({ ok: false, err: "Mot de passe incorrect." }, 401, false); }
  let b; try { b = await req.json(); } catch (e) { return json({ ok: false, err: "Requête illisible." }, 400, false); }

  if (b.action === "generer") {
    const n = Math.min(Math.max(parseInt(b.n, 10) || 1, 1), 200), codes = [];
    for (let i = 0; i < n; i++) codes.push(pretty(await newCode(env.SECRET)));
    return json({ ok: true, codes }, 200, false);
  }
  if (b.action === "liste") {
    const res = await env.LIC.list({ prefix: "c:", limit: 1000 });
    return json({ ok: true, items: res.keys.map(k => ({ id: k.name.slice(2), n: (k.metadata || {}).n || 0, revoked: !!(k.metadata || {}).r, t: (k.metadata || {}).t || 0 })), complete: res.list_complete }, 200, false);
  }
  const code = normCode(b.code);
  if (!(await isValid(code, env.SECRET))) return json({ ok: false, err: "Ce code n'est pas un code authentique." }, 200, false);
  const id = code.slice(0, 8);
  let rec = await readRec(env, id);
  if (b.action === "etat") return json({ ok: true, active: !!rec, devices: rec ? rec.devs.length : 0, revoked: !!(rec && rec.revoked), since: rec ? rec.t : null }, 200, false);
  if (!rec) rec = { devs: [], t: Date.now() };
  if (b.action === "liberer") { rec.devs = []; await writeRec(env, id, rec); return json({ ok: true }, 200, false); }
  if (b.action === "revoquer") { rec.revoked = true; await writeRec(env, id, rec); return json({ ok: true }, 200, false); }
  if (b.action === "retablir") { rec.revoked = false; await writeRec(env, id, rec); return json({ ok: true }, 200, false); }
  return json({ ok: false, err: "Action inconnue." }, 400);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (req.method === "GET" && url.pathname === "/admin") {
      return new Response(ADMIN_HTML, { headers: { ...SEC, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY",
        "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" } });
    }
    if (req.method === "GET" && url.pathname === "/") return json({ ok: true, service: "mon-maquis-licences" });
    if (req.method !== "POST") return json({ ok: false, err: "Méthode non autorisée." }, 405);
    if (!env.SECRET || !env.LIC) return json({ ok: false, err: "serveur" }, 503);
    if (parseInt(req.headers.get("Content-Length") || "0", 10) > 4000) return json({ ok: false, err: "invalide" }, 413);
    if (url.pathname === "/admin/api") return admin(env, req);
    let body; try { body = await req.json(); } catch (e) { return json({ ok: false, err: "invalide" }, 400); }
    if (url.pathname === "/activer") return json(await activate(env, body, false));
    if (url.pathname === "/verifier") return json(await activate(env, body, true));
    return json({ ok: false, err: "inconnu" }, 404);
  }
};

const ADMIN_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mon Maquis : licences</title>
<style>
:root{--bg:#faf6ee;--card:#fff;--tx:#2a2118;--mut:#7a6d5c;--br:#e4dac8;--pri:#b5541c;--ok:#1f8a4c;--ko:#c93a2b}
@media(prefers-color-scheme:dark){:root{--bg:#17130e;--card:#26200f;--tx:#f4ecdd;--mut:#b3a58f;--br:#3b3220}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:16px/1.4 system-ui,sans-serif;padding:16px;max-width:640px;margin:auto}
h1{font-size:22px;margin:8px 0 14px}h2{font-size:16px;margin:0 0 8px}
.k{background:var(--card);border:1px solid var(--br);border-radius:14px;padding:14px;margin-bottom:12px}
input,textarea{font:inherit;color:inherit;background:var(--bg);border:1px solid var(--br);border-radius:10px;padding:10px;width:100%}
textarea{min-height:140px;font-family:ui-monospace,monospace}
button{font:inherit;border:0;border-radius:10px;padding:10px 14px;background:var(--pri);color:#fff;font-weight:700;cursor:pointer;margin:6px 6px 0 0}
button.g{background:var(--br);color:var(--tx)}button.r{background:var(--ko)}
.row{display:flex;gap:8px}.row>*{flex:1}.msg{margin-top:8px;font-weight:700}.ok{color:var(--ok)}.ko{color:var(--ko)}
table{width:100%;border-collapse:collapse;font-size:14px}td,th{padding:6px 4px;border-bottom:1px solid var(--br);text-align:left}
code{font-family:ui-monospace,monospace}
</style></head><body>
<h1>🔑 Mon Maquis : licences</h1>
<div class="k"><h2>Mot de passe administrateur</h2><input id="tk" type="password" placeholder="ADMIN_TOKEN" autocomplete="off"><div id="m0" class="msg"></div></div>
<div class="k"><h2>Générer des codes</h2><div class="row"><input id="n" type="number" min="1" max="200" value="10"><button onclick="gen()">Générer</button></div>
<textarea id="out" readonly placeholder="Les codes apparaissent ici (un par ligne)"></textarea><button class="g" onclick="cp()">Copier la liste</button><div id="m1" class="msg"></div>
<small>Les codes sont valables dès qu'ils sont créés. Rien n'est stocké tant qu'un code n'est pas activé.</small></div>
<div class="k"><h2>Gérer un code</h2><input id="cd" placeholder="XXXX-XXXX-XXXX-XXXX" autocapitalize="characters">
<button class="g" onclick="act('etat')">Voir l'état</button><button class="g" onclick="act('liberer')">Libérer les téléphones</button><button class="r" onclick="act('revoquer')">Révoquer</button><button class="g" onclick="act('retablir')">Rétablir</button><div id="m2" class="msg"></div></div>
<div class="k"><h2>Codes activés</h2><button class="g" onclick="lst()">Actualiser</button><div id="m3" class="msg"></div><table id="tb"></table></div>
<script>
var $=function(i){return document.getElementById(i)};
$("tk").value=sessionStorage.getItem("mmtk")||"";
function api(b){sessionStorage.setItem("mmtk",$("tk").value);return fetch("/admin/api",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+$("tk").value},body:JSON.stringify(b)}).then(function(r){return r.json()})}
function say(id,t,ok){var e=$(id);e.textContent=t;e.className="msg "+(ok?"ok":"ko")}
function gen(){api({action:"generer",n:$("n").value}).then(function(r){if(!r.ok)return say("m1",r.err,0);$("out").value=r.codes.join("\\n");say("m1",r.codes.length+" codes prêts. Copie-les puis garde-les en lieu sûr.",1)}).catch(function(){say("m1","Pas de connexion.",0)})}
function cp(){var t=$("out");t.select();try{navigator.clipboard.writeText(t.value)}catch(e){document.execCommand("copy")}say("m1","Copié.",1)}
function act(a){api({action:a,code:$("cd").value}).then(function(r){if(!r.ok)return say("m2",r.err,0);
 if(a=="etat")say("m2",r.active?("Activé sur "+r.devices+" téléphone(s)"+(r.revoked?" · RÉVOQUÉ":"")):"Pas encore activé"+(r.revoked?" · RÉVOQUÉ":""),1);else say("m2","Fait.",1)}).catch(function(){say("m2","Pas de connexion.",0)})}
function lst(){api({action:"liste"}).then(function(r){if(!r.ok)return say("m3",r.err,0);var t=$("tb");t.innerHTML="<tr><th>Code</th><th>Tél.</th><th>Date</th><th></th></tr>";
 r.items.sort(function(a,b){return b.t-a.t}).forEach(function(x){var tr=document.createElement("tr");[x.id+"…",String(x.n),x.t?new Date(x.t).toLocaleDateString("fr-FR"):"",x.revoked?"révoqué":""].forEach(function(v){var td=document.createElement("td");td.textContent=v;tr.appendChild(td)});t.appendChild(tr)});
 say("m3",r.items.length+" code(s) activé(s)"+(r.complete?"":" (liste tronquée)"),1)}).catch(function(){say("m3","Pas de connexion.",0)})}
</script></body></html>`;
