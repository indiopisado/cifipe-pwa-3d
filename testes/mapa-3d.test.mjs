import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../web/mapa-3d.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture({ key = 'test-browser-key', online = true, preloaded = false } = {}) {
  const timers = new Map(), scripts = [], instances = [], imports = [], errors = [], selections = [];
  let timerId = 0;
  class Node {
    constructor(options = {}) { Object.assign(this, options); this.style = {}; this.dataset = {}; this.children = []; this.listeners = new Map(); }
    append(node) { this.children.push(node); node.parent = this; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
    setAttribute(name, value) { this[name] = value; }
    addEventListener(name, callback) { const list = this.listeners.get(name) || []; list.push(callback); this.listeners.set(name, list); }
    emit(name, details = {}) { for (const callback of this.listeners.get(name) || []) callback({ stopPropagation() {}, ...details }); }
  }
  class Map3DElement extends Node { constructor(options) { super(options); instances.push(this); } }
  class Marker3DInteractiveElement extends Node {}
  class Polyline3DInteractiveElement extends Node {}
  class Polygon3DInteractiveElement extends Node {}
  class PinElement extends Node {}
  const library = { Map3DElement, Marker3DInteractiveElement, Polyline3DInteractiveElement, Polygon3DInteractiveElement };
  const google = { maps: { async importLibrary(name) { imports.push(name); return name === 'marker' ? { PinElement } : library; } } };
  const window = { navigator: { onLine: online }, customElements: {}, addEventListener: Node.prototype.addEventListener, listeners: new Map() };
  const document = { createElement: () => new Node(), head: { append(script) { scripts.push(script); } } };
  if (preloaded) window.google = google;
  runInNewContext(source, { window, document, URL, URLSearchParams, setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); } });
  const container = new Node(); container.clientHeight = 400; container.clientWidth = 600;
  const controller = window.CifipeMapa3D.create({ container, apiKey: key, onError: error => errors.push(error), onSelect: id => selections.push(id) });
  const view = { center: { lat: -22.97, lng: -43.37 }, zoom: 16, height: 400 };
  async function start() {
    const pending = controller.show(view);
    if (scripts.length) { window.google = google; window.__cifipeMapsLoaded(); }
    await tick();
    instances.at(-1)?.emit('gmp-steadychange', { isSteady: true });
    await pending;
  }
  return { window, container, controller, view, scripts, instances, imports, errors, selections, timers, start };
}

const point = { idElemento: 'ponto', tipoGeometrico: 'Point', nome: 'Vistoria 1', coordenadasMapa: [[-22.97, -43.37]], simbolo: { src: 'https://download.avenza.com/images/pdfmaps_icons/red_pin.png' } };
const water = { idElemento: 'agua', tipoGeometrico: 'LineString', sistema: 'Água', nome: 'Rede água', coordenadasMapa: [[-22.97, -43.37], [-22.971, -43.371]] };
const sewer = { ...water, idElemento: 'esgoto', sistema: 'Esgoto' };
const boundary = { idElemento: 'limite', tipoGeometrico: 'Polygon', coordenadasMapa: [[-23, -43], [-23.01, -43], [-23.01, -43.01]], aneisMapa: [[[-23, -43], [-23.01, -43], [-23.01, -43.01]], [[-23.002, -43.002], [-23.004, -43.002], [-23.004, -43.004]]] };

test('não carrega Google ao criar o controller ou alterar dados; primeira exibição carrega uma única instância', async () => {
  const f = fixture();
  f.controller.setData([point, water], null);
  assert.equal(f.scripts.length, 0); assert.equal(f.instances.length, 0); assert.equal(f.imports.length, 0);
  await f.start();
  assert.equal(f.scripts.length, 1); assert.equal(f.instances.length, 1);
  assert.equal(new URL(f.scripts[0].src).origin, 'https://maps.googleapis.com');
  assert.deepEqual(f.imports, ['maps3d', 'marker']);
  f.controller.hide();
  assert.equal(f.container.hidden, true);
  await f.controller.show(f.view);
  assert.equal(f.instances.length, 1); assert.equal(f.scripts.length, 1); assert.equal(f.container.hidden, false);
  f.controller.hide();
});

test('desenha pontos, redes e limites com buracos, cores e identificação; clique e destaque usam id original', async () => {
  const f = fixture({ preloaded: true });
  f.controller.setData([point, water, sewer, boundary], null);
  await f.start();
  const map = f.instances[0];
  const visual = map.children.filter(node => node.strokeColor !== '#00000000');
  assert.equal(visual.length, 4);
  assert.equal(map.children[0].children[0].background, '#e53935');
  assert.equal(visual[1].strokeColor, '#20e4e4');
  assert.equal(visual[2].strokeColor, '#ff4da6');
  assert.equal(visual[3].strokeColor, '#ff802f');
  assert.equal(visual[3].innerPaths.length, 1);
  assert.equal(map.children[0]['aria-label'], 'Vistoria 1');
  map.children[1].emit('gmp-click');
  assert.deepEqual(f.selections, ['agua']);
  f.controller.setSelected('agua'); assert.equal(visual[1].strokeWidth, 9);
  assert.equal(map.children[1].strokeColor, '#00000000');
  f.controller.setSelected(null); assert.equal(visual[1].strokeColor, '#20e4e4');
  const retained = visual[1];
  f.controller.setData([water], 'agua');
  assert.equal(map.children.length, 2); assert.equal(map.children[1], retained);
  f.controller.hide();
});

test('conversão de câmera conserva centro e escala; seleção da tabela pode localizar elemento', async () => {
  const f = fixture({ preloaded: true });
  for (const lat of [-23, 0, 55]) for (const zoom of [5, 12, 18]) {
    const view = { center: { lat, lng: -43 }, zoom };
    const camera = f.window.CifipeMapa3D.cameraFromView(view, 400);
    const restored = f.window.CifipeMapa3D.viewFromCamera(camera, 400);
    assert.equal(restored.center.lat, lat); assert.equal(restored.center.lng, -43);
    assert.ok(Math.abs(restored.zoom - zoom) < 1e-8);
  }
  await f.start();
  f.controller.focus(point);
  assert.equal(f.controller.getView().center.lat, point.coordenadasMapa[0][0]);
  assert.ok(f.instances[0].range <= 500);
  f.controller.hide();
});

test('chave ausente e modo offline falham sem inserir script externo', async () => {
  for (const [options, code] of [[{ key: '' }, 'configuration'], [{ online: false }, 'network']]) {
    const f = fixture(options);
    await assert.rejects(f.controller.show(f.view), error => error.code === code && /Local ou Satélite/.test(error.message));
    assert.equal(f.scripts.length, 0); assert.equal(f.instances.length, 0);
    assert.equal(f.errors.length, 1);
    f.controller.hide();
  }
});

test('falhas de rede e autorização deixam caminho de retorno ao mapa 2D', async () => {
  const network = fixture();
  const pending = network.controller.show(network.view);
  network.scripts[0].onerror();
  await assert.rejects(pending, error => error.code === 'network');
  network.controller.hide(); assert.equal(network.container.hidden, true);
  const auth = fixture({ preloaded: true });
  await auth.start(); auth.window.gm_authFailure();
  assert.equal(auth.errors.at(-1).code, 'authentication');
  auth.controller.hide();
});

test('retorno 2D durante inicialização não cria instância 3D em segundo plano', async () => {
  const f = fixture();
  const pending = f.controller.show(f.view);
  f.controller.hide();
  f.window.google = { maps: { importLibrary: async name => { throw new Error(name); } } };
  // A conexão pode falhar depois de o usuário voltar; não altera a tela escolhida.
  f.scripts[0].onerror();
  await assert.rejects(pending);
  assert.equal(f.instances.length, 0); assert.equal(f.errors.length, 0); assert.equal(f.container.hidden, true);
});

test('alternância rápida resolve chamadas anteriores e mantém apenas a visualização mais recente', async () => {
  const f = fixture({ preloaded: true });
  const first = f.controller.show(f.view);
  await tick();
  const second = f.controller.show({ ...f.view, zoom: 17 });
  await tick();
  f.instances[0].emit('gmp-steadychange', { isSteady: true });
  assert.equal(await first, false); assert.equal(await second, true);
  assert.equal(f.instances.length, 1);
  assert.ok(Math.abs(f.controller.getView().zoom - 17) < 1e-8);
  f.controller.hide();
});

test('ausência de renderização até o timeout informa erro e permite ocultar o 3D', async () => {
  const f = fixture({ preloaded: true });
  const pending = f.controller.show(f.view);
  await tick();
  for (const callback of [...f.timers.values()]) callback();
  await assert.rejects(pending, error => error.code === 'rendering');
  assert.equal(f.errors.at(-1).code, 'rendering');
  f.controller.hide(); assert.equal(f.container.hidden, true);
});

test('service worker não intercepta Google, fotografias externas nem API; guarda módulo local', async () => {
  const model = readFileSync(new URL('../web/pwa/service-worker.js', import.meta.url), 'utf8');
  const handlers = new Map(), matches = [];
  const code = model.replace('__REVISAO__', 'test').replace('__ARQUIVOS__', JSON.stringify(['/mapa-3d.js']));
  runInNewContext(code, { URL, Response, self: { location: { origin: 'https://cifipe.example' }, addEventListener(name, fn) { handlers.set(name, fn); } }, caches: { open: async () => ({ match: async request => { matches.push(request.url); return 'cached'; } }) }, fetch() { assert.fail('recurso externo não deve ser buscado pelo SW'); } });
  for (const url of ['https://maps.googleapis.com/maps/api/js?key=test', 'https://kh.google.com/tiles', 'https://photos.example/photo.jpg', 'https://cifipe.example/api/listar-obras']) {
    handlers.get('fetch')({ request: { method: 'GET', url }, respondWith() { assert.fail('API ou recurso externo interceptado'); } });
  }
  let response;
  handlers.get('fetch')({ request: { method: 'GET', url: 'https://cifipe.example/mapa-3d.js' }, respondWith(value) { response = value; } });
  assert.equal(await response, 'cached'); assert.equal(matches.length, 1);
});
