import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {runInNewContext} from 'node:vm';

const root=new URL('../',import.meta.url);
execFileSync(process.execPath,['build.mjs'],{cwd:fileURLToPath(root),stdio:'pipe'});
const base='https://indiopisado.github.io/cifipe-pwa-3d/';
const bytes=name=>readFileSync(new URL('docs/'+name,root),'utf8');

function worker(){
  const handlers=new Map(), cacheCalls=[], deleted=[];
  let offline=false;
  const cache={addAll:async urls=>cacheCalls.push(...urls),match:async request=>({cached:typeof request==='string'?request:request.url})};
  const caches={open:async()=>cache,keys:async()=>[
    'cifipe-pages-'+encodeURIComponent('/cifipe-pwa-3d/')+'-old',
    'cifipe-pages-'+encodeURIComponent('/outra-pwa/')+'-old','cifipe-shell-original'
  ],delete:async name=>deleted.push(name)};
  runInNewContext(bytes('service-worker.js'),{URL,Response,self:{location:{origin:'https://indiopisado.github.io',href:base+'service-worker.js'},registration:{scope:base},clients:{claim:async()=>{}},addEventListener:(name,fn)=>handlers.set(name,fn)},caches,fetch:async request=>{if(offline)throw new Error('offline');return {network:request.url};}});
  return {handlers,cacheCalls,deleted,offline(){offline=true;}};
}

test('recursos HTML do dashboard e tela offline resolvem dentro da subpasta do Pages',()=>{
  for(const file of ['index.html','dashboard.html','sem-conexao.html']){
    const staticHtml=bytes(file).replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi,'$1</script>');
    for(const match of staticHtml.matchAll(/(?:src|href)="([^"]+)"/g)){
      const target=match[1];
      if(target.startsWith('#')||/^https?:/.test(target))continue;
      const resolved=new URL(target,base+file);
      assert.ok(resolved.pathname.startsWith('/cifipe-pwa-3d/'),file+': recurso escapou da subpasta');
      const relative=resolved.pathname.slice('/cifipe-pwa-3d/'.length)||'index.html';
      assert.ok(existsSync(new URL('docs/'+relative,root)),file+': recurso ausente '+relative);
    }
  }
});

test('manifesto cria instalacao independente no escopo correto',()=>{
  const manifest=JSON.parse(bytes('manifest.webmanifest'));
  for(const key of ['id','start_url','scope']) assert.equal(new URL(manifest[key],base+'manifest.webmanifest').href,base);
  assert.equal(manifest.display,'standalone');
  for(const icon of manifest.icons) assert.ok(new URL(icon.src,base).pathname.startsWith('/cifipe-pwa-3d/icons/'));
});

test('precache e limpeza do SW ficam restritos a esta PWA e preservam outras aplicacoes no mesmo host',async()=>{
  const f=worker(); let pending;
  f.handlers.get('install')({waitUntil:promise=>pending=promise}); await pending;
  assert.ok(f.cacheCalls.includes(base+'mapa-3d.js'));
  assert.ok(f.cacheCalls.includes(base+'icons/cifipe-192.png'));
  assert.ok(f.cacheCalls.every(url=>url.startsWith(base)));
  f.handlers.get('activate')({waitUntil:promise=>pending=promise}); await pending;
  assert.deepEqual(f.deleted,['cifipe-pages-'+encodeURIComponent('/cifipe-pwa-3d/')+'-old']);
});

test('SW ignora Google/backend/outro repositorio e fornece fallback offline dentro da subpasta',async()=>{
  const f=worker();
  for(const url of ['https://maps.googleapis.com/maps/api/js','https://example.supabase.co/functions/v1/detalhes-obra', 'https://indiopisado.github.io/outra-pwa/index.html']){
    f.handlers.get('fetch')({request:{url,method:'GET',mode:'cors'},respondWith(){assert.fail('Recurso alheio interceptado');}});
  }
  let response;
  f.handlers.get('fetch')({request:{url:base+'mapa-3d.js',method:'GET'},respondWith:p=>response=p});
  assert.equal((await response).cached,base+'mapa-3d.js');
  f.offline();
  f.handlers.get('fetch')({request:{url:base,method:'GET',mode:'navigate'},respondWith:p=>response=p});
  assert.equal((await response).cached,base+'sem-conexao.html');
});
