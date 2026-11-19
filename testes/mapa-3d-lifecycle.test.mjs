import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

// Exercise arrival order and native SDK failures; the existing adapter tests
// mostly supply every feature before the map exists.
function fixture({ rejectLabel, nativeCamera = false, geometrySetters = false } = {}) {
  const maps = [], errors = [], selections = [], statuses = [], cameras = [], timers = new Map();
  let nextTimer = 0;
  class Node {
    constructor(options = {}) { this.children = []; this.style = {}; this.dataset = {}; this.events = new Map(); Object.assign(this, options); }
    append(node) { node.parentNode = this; this.children.push(node); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); }
    setAttribute(name, value) { this[name] = value; }
    addEventListener(name, fn) { const list = this.events.get(name) || []; list.push(fn); this.events.set(name, list); }
    emit(name, details = {}) { for (const fn of this.events.get(name) || []) fn({ stopPropagation() {}, ...details }); }
  }
  class Map3DElement extends Node {
    constructor(options) {
      super(options); maps.push(this);
      if (nativeCamera) this.flyCameraTo = options => {
        cameras.push(options);
        Object.assign(this, options.endCamera);
        // Model a region 750 m above sea level: ground-relative zero is not
        // equivalent to an absolute altitude of zero.
        if (options.endCamera.altitudeMode === 'RELATIVE_TO_GROUND') this.center = { ...this.center, altitude: 750 + this.center.altitude };
      };
    }
  }
  class Marker3DInteractiveElement extends Node {
    constructor(options) {
      if (rejectLabel && options.label?.startsWith(rejectLabel)) throw new Error('Native overlay rejected');
      super(options);
    }
  }
  class Polyline3DInteractiveElement extends Node {
    constructor(options) {
      super(geometrySetters ? Object.fromEntries(Object.entries(options).filter(([key]) => key !== 'path')) : options);
      if (geometrySetters) {
        this.pathAssignments = 0;
        Object.defineProperty(this, 'path', { get() { return this.assignedPath; }, set(value) { this.pathAssignments++; this.assignedPath = value; } });
      }
    }
  }
  class Polygon3DInteractiveElement extends Node {
    constructor(options) {
      super(geometrySetters ? Object.fromEntries(Object.entries(options).filter(([key]) => !['path','innerPaths'].includes(key))) : options);
      if (geometrySetters) {
        this.pathAssignments = 0;
        Object.defineProperty(this, 'path', { get() { return this.assignedPath; }, set(value) { this.pathAssignments++; this.assignedPath = value; } });
        Object.defineProperty(this, 'innerPaths', { get() { return this.assignedHoles; }, set(value) { this.assignedHoles = value; } });
      }
    }
  }
  class PinElement extends Node {}
  const library = { Map3DElement, Marker3DInteractiveElement, Polyline3DInteractiveElement, Polygon3DInteractiveElement };
  const window = {
    navigator: { onLine: true }, customElements: {}, addEventListener() {},
    google: { maps: { async importLibrary(name) { return name === 'marker' ? { PinElement } : library; } } },
  };
  const document = { createElement: () => new Node(), head: { append() { assert.fail('preloaded runtime must be reused'); } } };
  runInNewContext(readFileSync(new URL('../web/mapa-3d.js', import.meta.url), 'utf8'), {
    window, document, URL, URLSearchParams,
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const container = new Node(); container.clientHeight = 400; container.clientWidth = 600;
  const controller = window.CifipeMapa3D.create({
    container, apiKey: 'test-key', onSelect: id => selections.push(id), onError: error => errors.push(error), onDataChange: status => statuses.push(status),
  });
  const view = { center: { lat: -23, lng: -43 }, zoom: 17 };
  async function start() {
    const promise = controller.show(view);
    await new Promise(resolve => setImmediate(resolve));
    maps[0].emit('gmp-steadychange', { isSteady: true });
    return promise;
  }
  return { controller, maps, errors, selections, statuses, cameras, view, start };
}

const point = id => ({ idElemento: id, tipoGeometrico: 'Point', nome: id, coordenadasMapa: [[-23, -43]] });
const line = id => ({ idElemento: id, tipoGeometrico: 'LineString', nome: id, sistema: 'Água', coordenadasMapa: [[-23, -43], [-23.001, -43.001]] });
const ids = map => [...new Set(map.children.map(node => node.dataset.elemento))];

test('dados da obra recebidos depois da primeira cena criam camadas selecionáveis na mesma instância', async () => {
  const f = fixture();
  await f.start();
  assert.equal(f.maps[0].children.length, 0);
  f.controller.setData([point('vistoria'), line('rede')], 'rede');
  assert.deepEqual(ids(f.maps[0]), ['vistoria', 'rede']);
  f.maps[0].children.find(node => node.dataset.elemento === 'vistoria').emit('gmp-click');
  assert.deepEqual(f.selections, ['vistoria']);
  assert.equal(f.maps.length, 1);
  f.controller.hide();
});

test('filtro e nova obra substituem camadas após o mapa estar pronto, sem reter elementos anteriores', async () => {
  const f = fixture();
  await f.start();
  const a = point('a'), b = line('b');
  f.controller.setData([a, b], 'a');
  const retained = f.maps[0].children.find(node => node.dataset.elemento === 'b');
  f.controller.setData([b], 'b');
  assert.deepEqual(ids(f.maps[0]), ['b']);
  assert.equal(f.maps[0].children[0], retained);
  f.controller.setData([], null);
  assert.equal(f.maps[0].children.length, 0);
  f.controller.setData([point('outra-obra')], null);
  assert.deepEqual(ids(f.maps[0]), ['outra-obra']);
  assert.equal(f.maps.length, 1);
  f.controller.hide();
});

test('dados recebidos durante a criação do mapa usam a revisão mais recente ao anexar camadas', async () => {
  const f = fixture();
  f.controller.setData([point('anterior')], null);
  const promise = f.controller.show(f.view);
  f.controller.setData([point('recente')], null);
  await new Promise(resolve => setImmediate(resolve));
  f.maps[0].emit('gmp-steadychange', { isSteady: true });
  assert.equal(await promise, true);
  assert.deepEqual(ids(f.maps[0]), ['recente']);
  f.controller.hide();
});

test('uma camada recusada pelo SDK não impede camadas válidas recebidas depois da cena', async () => {
  const f = fixture({ rejectLabel: 'recusado' });
  await f.start();
  assert.doesNotThrow(() => f.controller.setData([point('recusado'), point('válido')], null));
  assert.ok(ids(f.maps[0]).includes('válido'));
  assert.equal(f.errors.length, 0, 'erro de uma camada não deve inutilizar a cena');
  assert.equal(f.controller.getDataStatus().requested, 2);
  assert.equal(f.controller.getDataStatus().rendered, 1);
  assert.equal(f.controller.getDataStatus().failed, 1);
  assert.equal(f.controller.getDataStatus().pending, false);
  assert.equal(f.statuses.at(-1).failed, 1);
  f.controller.hide();
});

test('anotações usam superfície da malha e setters nativos, preservando vértices e recortes', async () => {
  const f = fixture({ geometrySetters: true });
  await f.start();
  const route = { ...line('rede-longa'), coordenadasMapa: [[-23,-43],[-23.01,-43.01]] };
  const polygon = { idElemento: 'limite', tipoGeometrico: 'Polygon', coordenadasMapa: [[-23,-43],[-23.01,-43],[-23.01,-43.01],[-23,-43]], aneisMapa: [
    [[-23,-43],[-23.01,-43],[-23.01,-43.01],[-23,-43]],
    [[-23.002,-43.002],[-23.004,-43.002],[-23.004,-43.004],[-23.002,-43.002]],
  ] };
  f.controller.setData([point('ponto'), route, polygon], null);
  assert.equal(f.controller.getDataStatus().rendered, 3);
  for (const node of f.maps[0].children) {
    assert.equal(node.altitudeMode, 'RELATIVE_TO_MESH');
    if (node.position) assert.equal(node.position.altitude, 2);
    if (node.path) {
      assert.ok(node.pathAssignments >= 1, 'geometria precisa passar pelo setter, mesmo quando o construtor a ignora');
      assert.ok(node.path.length > 2, 'trechos longos precisam acompanhar a superfície entre vértices');
      assert.ok(node.path.every(p => p.altitude === 2));
      assert.ok(node.path.some(p => p.lat === route.coordenadasMapa[0][0] && p.lng === route.coordenadasMapa[0][1]));
    }
    if (node.innerPaths) {
      assert.equal(node.innerPaths.length, 1);
      assert.ok(node.innerPaths[0].length > 4);
      assert.ok(node.innerPaths[0].every(p => p.altitude === 2));
    }
  }
  f.controller.hide();
});

test('câmera inicial e foco de tabela usam altitude relativa ao terreno em regiões elevadas', async () => {
  const f = fixture({ nativeCamera: true });
  await f.start();
  assert.equal(f.cameras[0].endCamera.altitudeMode, 'RELATIVE_TO_GROUND');
  assert.equal(f.cameras[0].durationMillis, 0);
  assert.equal(f.controller.getView().center.altitude, 750);
  f.controller.focus(point('vistoria'));
  assert.equal(f.cameras.at(-1).endCamera.altitudeMode, 'RELATIVE_TO_GROUND');
  assert.equal(f.cameras.at(-1).endCamera.center.altitude, 0, 'a altitude absoluta anterior não deve ser somada novamente ao relevo');
  assert.equal(f.controller.getView().center.altitude, 750);
  f.controller.hide();
});
