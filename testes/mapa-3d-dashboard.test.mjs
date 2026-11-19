import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

function prepare() {
  const nodes = new Map(), controls = [], changes = [], datasets = [], focuses = [], tiles = [];
  class Node {
    constructor() { this.children = []; this.dataset = {}; this.value = ''; this.style = {}; this.listeners = new Map(); this.classes = new Set(); this.classList = { add: v => this.classes.add(v), remove: v => this.classes.delete(v), toggle: (v, state) => state ? this.classes.add(v) : this.classes.delete(v) }; }
    appendChild(node) { if (node.fragment) this.children.push(...node.children); else this.children.push(node); return node; }
    replaceChildren(...children) { this.children = children; }
    setAttribute(key, value) { this[key] = value; }
    removeAttribute(key) { delete this[key]; }
    addEventListener(name, fn) { this.listeners.set(name, fn); }
  }
  function node(id) { if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id); }
  for (const type of ['padrao', 'satelite', '3d']) { const button = new Node(); button.dataset.fundo = type; controls.push(button); }
  const map = { center: { lat: -23, lng: -43 }, zoom: 16, getCenter() { return this.center; }, getZoom() { return this.zoom; }, setView(center, zoom) { this.center = Array.isArray(center) ? { lat: center[0], lng: center[1] } : center; this.zoom = zoom; }, invalidateSize() {}, removeLayer() {}, fitBounds(coords) { this.center = { lat: coords[0][0], lng: coords[0][1] }; } };
  const layer = () => ({ on() { return this; }, addTo() { return this; }, setStyle() {}, bringToFront() {} });
  const controller = { async show(view) { changes.push(view); this.view = view; return true; }, hide() {}, getView() { return this.view; }, setData(data, id) { datasets.push({ data, id }); }, setSelected(id) { this.selected = id; }, focus(item) { focuses.push(item); } };
  let creates = 0, onSelect;
  const document = { getElementById: node, querySelector: () => ({ content: '' }), querySelectorAll: selector => selector === '[data-fundo]' ? controls : [], createElement: () => new Node(), createTextNode: text => ({ textContent: text }), createDocumentFragment: () => Object.assign(new Node(), { fragment: true }) };
  const window = { CifipeMapa3D: { create(options) { creates++; onSelect = options.onSelect; return controller; } } };
  const L = { tileLayer(url) { tiles.push(url); return layer(); }, marker: layer, polyline: layer, polygon: layer, divIcon() {} };
  const html = readFileSync(new URL('../web/dashboard.html', import.meta.url), 'utf8');
  const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1].replace(/iniciarInterface\(\);\s*$/, '');
  const api = runInNewContext(code + `\nmapa = testMap; camadaTrechos = {clearLayers(){}};\n({trocarFundoMapa, selecionarElemento, aplicarFiltros, capturarConsulta, setData(data){dadosKMZCarregados=data;dadosExibidos=data}, state(){return {tipoMapa,idSelecionado,dadosExibidos}}, lines:linhasPorElemento})`, { window, document, L, testMap: map, URL, console });
  node('obra').value = 'obra-original';
  node('mapa').clientHeight = 400;
  return { api, node, map, controller, controls, changes, datasets, focuses, tiles, creates: () => creates, select: id => onSelect(id) };
}

const point = { idElemento: 'p1', tipoGeometrico: 'Point', nome: 'PV 1', coordenadasMapa: [[-23, -43]], sistema: 'Água', status: 'Executado', descricao: 'Ponto vistoriado', fotos: [{ disponivel: true, src: 'data:image/png;base64,AA==', nome: 'Foto da vistoria' }] };
const line = { idElemento: 'l1', tipoGeometrico: 'LineString', nome: 'Trecho 1', coordenadasMapa: [[-23, -43], [-23.001, -43.001]], sistema: 'Esgoto', status: 'Executado', descricao: 'Rede vistoriada', fotos: [] };

test('dashboard conserva obra, filtros e seleção ao alternar Local, Satélite e 3D', async () => {
  const f = prepare(); f.api.setData([point, line]);
  f.node('status').value = 'Executado'; f.api.selecionarElemento('p1', false);
  const before = JSON.stringify(f.api.capturarConsulta());
  for (const mode of ['padrao', 'satelite', '3d', 'padrao', '3d', 'satelite']) await f.api.trocarFundoMapa(mode);
  assert.equal(JSON.stringify(f.api.capturarConsulta()), before);
  assert.equal(f.creates(), 1); assert.equal(f.changes.length, 2);
  assert.equal(f.api.state().tipoMapa, 'satelite');
  assert.equal(f.controls.find(button => button.dataset.fundo === 'satelite')['aria-pressed'], 'true');
  assert.equal(f.node('mapa3d').hidden, true);
});

test('seleção do mapa 3D atualiza ficha, descrição, fotos e linha da tabela; seleção pela tabela localiza em 3D', async () => {
  const f = prepare(); f.api.setData([point, line]); f.api.aplicarFiltros(true);
  await f.api.trocarFundoMapa('3d');
  f.select('p1');
  assert.equal(f.api.state().idSelecionado, 'p1');
  assert.equal(f.node('tituloSelecao').textContent, 'PONTO SELECIONADO');
  assert.equal(f.node('descricaoElemento').textContent, 'Ponto vistoriado');
  assert.equal(f.node('photos').children.length, 1);
  assert.equal(f.api.lines.get('p1')['aria-current'], 'true');
  assert.equal(f.controller.selected, 'p1');
  f.api.lines.get('l1').listeners.get('click')();
  assert.equal(f.api.state().idSelecionado, 'l1');
  assert.equal(f.node('descricaoElemento').textContent, 'Rede vistoriada');
  assert.equal(f.node('photos').children.length, 0);
  assert.equal(f.focuses.at(-1).idElemento, 'l1');
});

test('filtros em 3D atualizam dados sem recriar instância, preservam seleção válida e limpam seleção oculta', async () => {
  const f = prepare(); f.api.setData([point, line]);
  await f.api.trocarFundoMapa('3d'); f.select('p1');
  f.node('status').value = 'Executado'; f.api.aplicarFiltros(true);
  assert.equal(f.api.state().idSelecionado, 'p1');
  f.node('sistema').value = 'Esgoto'; f.api.aplicarFiltros(true);
  assert.equal(f.api.state().idSelecionado, null);
  assert.equal(f.datasets.at(-1).data.length, 1);
  assert.equal(f.datasets.at(-1).data[0].idElemento, 'l1');
  assert.equal(f.node('photos').children.length, 0);
  assert.equal(f.creates(), 1);
});

test('retorno ao 2D transfere centro e escala atuais da câmera 3D', async () => {
  const f = prepare(); await f.api.trocarFundoMapa('3d');
  f.controller.view = { center: { lat: -24, lng: -44 }, zoom: 14, height: 400 };
  await f.api.trocarFundoMapa('padrao');
  assert.deepEqual(f.map.center, { lat: -24, lng: -44 }); assert.equal(f.map.zoom, 14);
});
