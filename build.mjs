import {createHash} from 'node:crypto';
import {copyFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=new URL('./',import.meta.url);
if(existsSync(new URL('.env.local',root))) process.loadEnvFile(fileURLToPath(new URL('.env.local',root)));
const out=new URL('docs/',root);
await mkdir(new URL('icons/',out),{recursive:true});
let html=await readFile(new URL('web/dashboard.html',root),'utf8');
const key=(process.env.GOOGLE_MAPS_API_KEY||'').trim();
if(key){
  if(!/^[A-Za-z0-9_-]{20,200}$/.test(key)) throw new Error('Formato invalido da chave Google Maps.');
  html=html.replace(/(<meta name="google-maps-api-key" content=")[^"]*(">)/,'$1'+key+'$2');
}
const inicio=await readFile(new URL('web/index.html',root),'utf8');
const files=new Map([['index.html',inicio],['dashboard.html',html]]);
for(const name of ['mapa-3d.js','relatorio.js','instalacao.js']) files.set(name,await readFile(new URL('web/'+name,root)));
for(const name of ['manifest.webmanifest','sem-conexao.html']) files.set(name,await readFile(new URL('web/pwa/'+name,root)));
for(const size of [180,192,512]) files.set('icons/cifipe-'+size+'.png',await readFile(new URL('web/icons/cifipe-'+size+'.png',root)));
files.set('.nojekyll','');
const hash=createHash('sha256');
for(const [name,bytes] of files){
  if(/\.(html|js)$/.test(name)&&/sb_secret_[A-Za-z0-9_-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(String(bytes))) throw new Error('Credencial secreta encontrada em recurso publico.');
  hash.update(name).update(bytes);
  await writeFile(new URL(name,out),bytes);
}
const template=await readFile(new URL('web/pwa/service-worker.js',root),'utf8');
hash.update(template);
const version=hash.digest('hex').slice(0,12);
const worker=template.replace('__REVISAO__',version).replace('__ARQUIVOS__',JSON.stringify([...files.keys()].map(name=>'./'+name)));
await writeFile(new URL('service-worker.js',out),worker);
await writeFile(new URL('build-info.json',out),JSON.stringify({version,files:files.size+1,app:'C.I.FIPE 3D'},null,2)+'\n');
console.log('PWA GitHub Pages pronta em docs/ ('+version+').');
