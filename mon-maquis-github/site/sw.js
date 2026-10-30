/* Mon Maquis : fonctionne sans internet. Pour publier une mise à jour, changer le numéro de V. */
var V="mon-maquis-v8",F=["./","index.html","manifest.webmanifest","icon-192.png","icon-512.png"];
function plain(r){return r&&r.redirected?r.blob().then(function(b){return new Response(b,{status:r.status,statusText:r.statusText,headers:r.headers})}):Promise.resolve(r)}
self.addEventListener("install",function(e){
 e.waitUntil(caches.open(V).then(function(c){
  return Promise.all(F.map(function(u){return fetch(u,{cache:"reload"}).then(plain).then(function(r){if(!r.ok)throw new Error(u);return c.put(u,r)})}))
 }).then(function(){return self.skipWaiting()}))});
self.addEventListener("activate",function(e){
 e.waitUntil(caches.keys().then(function(k){return Promise.all(k.filter(function(x){return x!=V}).map(function(x){return caches.delete(x)}))}).then(function(){return self.clients.claim()}))});
/* Ouvre tout de suite depuis la mémoire du téléphone, puis met à jour en arrière-plan quand il y a du réseau. */
self.addEventListener("fetch",function(e){
 var q=e.request;
 if(q.method!="GET"||new URL(q.url).origin!=location.origin)return;
 e.respondWith(caches.open(V).then(function(c){return c.match(q,{ignoreSearch:true}).then(function(hit){
  var net=fetch(q).then(function(r){if(r&&r.ok){return plain(r).then(function(p){c.put(q,p.clone());return p})}return r}).catch(function(){return null});
  if(hit){e.waitUntil(net);return hit}
  return net.then(function(r){if(r)return r;return q.mode=="navigate"?c.match("index.html"):Response.error()})
 })}))});
