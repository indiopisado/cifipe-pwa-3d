const base = new URL('./', self.registration?.scope || self.location.href || self.location.origin + '/');
const cachePrefix = 'cifipe-pages-' + encodeURIComponent(base.pathname) + '-';
const cacheName = cachePrefix + '__REVISAO__';
const arquivos = __ARQUIVOS__;
const urls = arquivos.map(path => new URL(path,base).href);
const estaticos = new Set(urls);

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(cacheName).then(cache=>cache.addAll(urls)));
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    await Promise.all(names.filter(name=>name.startsWith(cachePrefix)&&name!==cacheName).map(name=>caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  const {request}=event;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  // Google, fotos e backend seguem para rede e nunca entram no cache local.
  if(url.origin!==base.origin || !url.pathname.startsWith(base.pathname) || url.pathname.startsWith(new URL('./api/',base).pathname))return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).catch(async()=>{
      const cache=await caches.open(cacheName);
      return await cache.match(new URL('./sem-conexao.html',base).href)||Response.error();
    }));
    return;
  }
  if(estaticos.has(url.href)&&!url.search){
    event.respondWith(caches.open(cacheName).then(async cache=>await cache.match(request)||fetch(request)));
  }
});
