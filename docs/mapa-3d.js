/* Google Maps 3D adapter. The Google runtime is fetched only by show().
 * References checked 2026-11-19: /javascript/3d/overview,
 * /javascript/reference/3d-map and /javascript/reference/3d-map-draw.
 */
(function (global) {
  'use strict';
  let librariesPromise;
  let authError;
  const authListeners = new Set();
  const TIMEOUT = 30000;
  const FOV = 45;
  const SURFACE_OFFSET = 2;
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const failure = (code, message) => Object.assign(new Error(message), { code });
  function withTimeout(promise, code) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(failure(code, messages[code])), TIMEOUT);
      Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
    });
  }
  const messages = {
    configuration: 'A chave do Google Maps 3D ainda não foi configurada. Use Local ou Satélite.',
    authentication: 'O Google Maps recusou a chave ou a autorização deste domínio. Use Local ou Satélite e confira a configuração da API.',
    network: 'Não foi possível conectar ao Google Maps 3D. Verifique a conexão ou retorne a Local ou Satélite.',
    unsupported: 'O mapa 3D não está disponível neste navegador ou aparelho. Use Local ou Satélite.',
    rendering: 'O Google Maps 3D não conseguiu iniciar. Verifique a conexão e o suporte gráfico do navegador. Use Local ou Satélite.'
  };

  function loadLibraries(apiKey) {
    if (authError) return Promise.reject(authError);
    if (librariesPromise) return librariesPromise;
    if (!apiKey || /^(?:YOUR_|SUA_|COLOQUE_|__)/i.test(apiKey)) return Promise.reject(failure('configuration', messages.configuration));
    if (global.navigator?.onLine === false) return Promise.reject(failure('network', messages.network));
    if (!global.customElements) return Promise.reject(failure('unsupported', messages.unsupported));
    const previousAuthFailure = global.gm_authFailure;
    global.gm_authFailure = function () {
      authError = failure('authentication', messages.authentication);
      authListeners.forEach(listener => listener(authError));
      if (typeof previousAuthFailure === 'function') previousAuthFailure();
    };
    librariesPromise = new Promise((resolve, reject) => {
      let timer;
      let script;
      let finished = false;
      const onAuth = error => finish(error);
      function finish(error) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        authListeners.delete(onAuth);
        if (error) {
          // A connection error can be retried. Authorization errors need a reload
          // after configuration is corrected; no duplicate Google runtime is added.
          if (script) script.remove();
          reject(error);
          return;
        }
        resolve();
      }
      authListeners.add(onAuth);
      timer = setTimeout(() => finish(failure('network', messages.network)), TIMEOUT);
      if (global.google?.maps?.importLibrary) { finish(); return; }
      script = document.createElement('script');
      script.id = 'cifipe-google-maps-runtime';
      script.async = true;
      script.referrerPolicy = 'strict-origin-when-cross-origin';
      const url = new URL('https://maps.googleapis.com/maps/api/js');
      url.search = new URLSearchParams({ key: apiKey, v: 'beta', loading: 'async', callback: '__cifipeMapsLoaded', language: 'pt-BR', region: 'BR' }).toString();
      script.src = url.href;
      global.__cifipeMapsLoaded = () => { delete global.__cifipeMapsLoaded; finish(); };
      script.onerror = () => { delete global.__cifipeMapsLoaded; finish(failure('network', messages.network)); };
      document.head.append(script);
    }).then(async () => {
      const result = await withTimeout(Promise.all([global.google.maps.importLibrary('maps3d'), global.google.maps.importLibrary('marker')]), 'network');
      if (authError) throw authError;
      const [maps3d, marker] = result;
      for (const name of ['Map3DElement', 'Marker3DInteractiveElement', 'Polyline3DInteractiveElement', 'Polygon3DInteractiveElement']) {
        if (typeof maps3d[name] !== 'function') throw failure('unsupported', messages.unsupported);
      }
      return { ...maps3d, ...marker };
    }).catch(error => {
      librariesPromise = undefined;
      throw error.code ? error : failure('unsupported', messages.unsupported);
    });
    return librariesPromise;
  }

  function metersPerPixel(lat, zoom) {
    return 156543.03392804097 * Math.max(.01, Math.cos(lat * Math.PI / 180)) / 2 ** zoom;
  }
  function cameraFromView(view, height, oldCamera) {
    const lat = Number(view.center.lat), lng = Number(view.center.lng);
    const tilt = clamp(Number.isFinite(view.tilt) ? view.tilt : (oldCamera?.tilt ?? 45), 0, 67);
    const heading = Number.isFinite(view.heading) ? view.heading : (oldCamera?.heading ?? 0);
    const range = Number.isFinite(view.range) ? view.range : metersPerPixel(lat, Number.isFinite(view.zoom) ? view.zoom : 14) * height /
      (2 * Math.tan(FOV * Math.PI / 360) * Math.max(.3, Math.cos(tilt * Math.PI / 180)));
    return { center: { lat, lng, altitude: Number(view.center.altitude) || 0 }, range: clamp(range, 30, 20000000), tilt, heading };
  }
  function viewFromCamera(camera, height) {
    const center = camera.center;
    if (!center) return null;
    const lat = typeof center.lat === 'function' ? center.lat() : center.lat;
    const lng = typeof center.lng === 'function' ? center.lng() : center.lng;
    const range = Number(camera.range) || 1000, tilt = Number(camera.tilt) || 0;
    const span = range * 2 * Math.tan(FOV * Math.PI / 360) * Math.max(.3, Math.cos(tilt * Math.PI / 180));
    const zoom = Math.log2(156543.03392804097 * Math.max(.01, Math.cos(lat * Math.PI / 180)) * height / span);
    return { center: { lat, lng, altitude: Number(center.altitude) || 0 }, zoom: clamp(zoom, 1, 22), height, tilt, heading: Number(camera.heading) || 0, range };
  }
  function path(coords) {
    return (coords || []).filter(p => Array.isArray(p) && p[0] !== null && p[1] !== null && p[0] !== '' && p[1] !== '')
      .map(p => ({ lat: Number(p[0]), lng: Number(p[1]), altitude: SURFACE_OFFSET }))
      .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180);
  }
  function assignPath(node, coords, holes) {
    // beta runtimes can lag the current reference. Assign native setters
    // explicitly instead of relying only on constructor option conversion.
    if ('path' in node || !('coordinates' in node || 'outerCoordinates' in node)) node.path = coords;
    else if ('outerCoordinates' in node) node.outerCoordinates = coords;
    else node.coordinates = coords;
    if (holes) {
      if ('innerPaths' in node || !('innerCoordinates' in node)) node.innerPaths = holes;
      else node.innerCoordinates = holes;
    }
  }
  function surfacePath(coords) {
    if (coords.length < 2) return coords;
    const length = (a, b) => Math.hypot((b.lat-a.lat)*111320, (b.lng-a.lng)*111320*Math.cos((a.lat+b.lat)*Math.PI/360));
    const lengths = coords.slice(1).map((p,i)=>length(coords[i],p));
    const step = Math.max(20, lengths.reduce((sum,n)=>sum+n,0)/2000);
    const result = [coords[0]];
    coords.slice(1).forEach((b,i)=>{
      const a=coords[i], count=Math.max(1,Math.ceil(lengths[i]/step));
      for(let j=1;j<count;j++) result.push({lat:a.lat+(b.lat-a.lat)*j/count,lng:a.lng+(b.lng-a.lng)*j/count,altitude:SURFACE_OFFSET});
      result.push(b);
    });
    return result;
  }
  function pointColor(item) {
    const match = String(item.simbolo?.src || '').match(/\/(red|yellow|green|blue|orange|purple|pink|white|black|gray|grey)_pin(?:_classic)?\.png(?:\?.*)?$/i);
    return match ? ({ red: '#e53935', yellow: '#ffd600', green: '#43a047', blue: '#1976d2', orange: '#ff8f00', purple: '#8e24aa', pink: '#ec407a', white: '#ffffff', black: '#212121', gray: '#9aa5b1', grey: '#9aa5b1' })[match[1].toLowerCase()] : '#9aa5b1';
  }
  function itemColor(item) {
    if (item.tipoGeometrico === 'Polygon') return '#ff802f';
    if (item.tipoGeometrico === 'Point') return pointColor(item);
    return normalize(item.sistema) === 'agua' ? '#20e4e4' : normalize(item.sistema) === 'esgoto' ? '#ff4da6' : '#9aa5b1';
  }
  function dashedPaths(coords) {
    const distance = (a, b) => Math.hypot((b.lat - a.lat) * 111320, (b.lng - a.lng) * 111320 * Math.cos((a.lat + b.lat) * Math.PI / 360));
    const lengths = coords.slice(1).map((p, i) => distance(coords[i], p));
    const total = lengths.reduce((sum, n) => sum + n, 0);
    // Physical dashes keep all original vertices. At most 64 visible dash
    // overlays per inspected element, independent of its length or zoom.
    const dash = Math.max(8, total / 64 / 1.7), gap = dash * .7;
    const result = [];
    let drawing = true, remaining = dash, current = [coords[0]];
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1], b = coords[i], length = lengths[i - 1];
      if (length <= 1e-6) { if (drawing) current.push(b); continue; }
      let offset = 0;
      while (offset < length - 1e-6) {
        const take = Math.min(remaining, length - offset);
        offset += take;
        const t = offset / length, p = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t, altitude: SURFACE_OFFSET };
        if (drawing) current.push(p);
        remaining -= take;
        if (remaining <= 1e-6) {
          if (drawing && current.length >= 2) result.push(current);
          drawing = !drawing;
          remaining = drawing ? dash : gap;
          current = drawing ? [p] : [];
        }
      }
    }
    if (drawing && current.length >= 2) result.push(current);
    return result;
  }

  function create(options) {
    const { container, apiKey, onSelect = () => {}, onError = () => {}, onReady = () => {}, onDataChange = () => {} } = options;
    if (!container) throw new Error('Informe o contêiner do mapa 3D.');
    let map, library, starting, wanted = false, loaded = false, failed = false;
    let items = [], selectedId = null, previousView;
    let readyResolve, readyReject, renderTimer, visibilityToken = 0;
    const overlays = new Map();
    container.dataset.versaoCamadas = '20261119-3';
    let dataStatus = { requested: 0, rendered: 0, failed: 0, pending: true };
    const height = () => Math.max(180, container.clientHeight || previousView?.height || 400);
    function report(error) {
      failed = true;
      clearTimeout(renderTimer);
      if (readyReject) { readyReject(error); readyReject = null; readyResolve = null; }
      if (wanted) onError(error);
    }
    authListeners.add(report);
    function clearOverlay(entry) { entry.nodes.forEach(node => node.remove()); }
    function applySelection(entry, selected) {
      (entry.visualNodes || entry.nodes).forEach(node => {
        if (entry.point) {
          node.zIndex = selected ? 1000 : 10;
          if (entry.pin) { entry.pin.borderColor = selected ? '#fff700' : '#ffffff'; entry.pin.scale = selected ? 1.3 : 1; }
        } else {
          node.strokeColor = selected ? '#fff700' : entry.color;
          node.strokeWidth = selected ? entry.width + 3 : entry.width;
          node.zIndex = selected ? 1000 : entry.polygon ? 0 : 5;
        }
      });
    }
    function buildOverlay(item) {
      const coords = path(item.coordenadasMapa);
      const point = item.tipoGeometrico === 'Point', polygon = item.tipoGeometrico === 'Polygon';
      if (coords.length < (point ? 1 : polygon ? 3 : 2)) return null;
      const color = itemColor(item);
      const width = normalize(item.sistema) === 'agua' ? 6 : 4;
      const label = String(item.nome || item.nomeElemento || item.identificacao || item.idElemento || '') + (item.status ? ' — ' + item.status : '');
      // These are inspection annotations, not surveyed elevations. Keep their
      // original lat/lng while lifting the display above the photorealistic
      // mesh, which may contain buildings/trees above the bare-earth terrain.
      const common = { altitudeMode: 'RELATIVE_TO_MESH', extruded: false };
      let node, pin, nodes, visualNodes;
      if (point) {
        node = new library.Marker3DInteractiveElement({ ...common, position: coords[0], label, title: label, drawsWhenOccluded: true, collisionBehavior: 'REQUIRED', sizePreserved: true });
        node.position = coords[0];
        if (library.PinElement) {
          pin = new library.PinElement({ background: color, borderColor: '#ffffff', glyphColor: '#ffffff', scale: 1 });
          node.append(pin);
        }
      } else if (polygon) {
        const rings = (item.aneisMapa || [item.coordenadasMapa]).map(path).filter(ring => ring.length >= 3);
        node = new library.Polygon3DInteractiveElement({ ...common, path: rings[0] || coords, innerPaths: rings.slice(1), strokeColor: color, strokeWidth: width, fillColor: '#ff802f00', drawsOccludedSegments: true, zIndex: 0 });
        assignPath(node, surfacePath(rings[0] || coords), rings.slice(1).map(surfacePath));
      } else {
        const hit = new library.Polyline3DInteractiveElement({ ...common, path: coords, strokeColor: '#00000000', strokeWidth: 24, drawsOccludedSegments: true, zIndex: 4 });
        assignPath(hit, surfacePath(coords));
        const pieces = normalize(item.status) === 'em execucao' ? dashedPaths(coords) : [coords];
        visualNodes = pieces.map(piece => new library.Polyline3DInteractiveElement({ ...common, path: piece, strokeColor: color, strokeWidth: width, outerColor: '#071726', outerWidth: .15, drawsOccludedSegments: true, zIndex: 5 }));
        visualNodes.forEach((line,i)=>assignPath(line,surfacePath(pieces[i])));
        nodes = [hit, ...visualNodes];
      }
      nodes = nodes || [node];
      try { nodes.forEach(element => {
        element.title = label;
        element.setAttribute('aria-label', label);
        element.dataset.elemento = String(item.idElemento);
        element.addEventListener('gmp-click', event => { event.stopPropagation(); onSelect(item.idElemento); });
        map.append(element);
      }); } catch(error) { nodes.forEach(element=>element.remove()); throw error; }
      return { nodes, visualNodes, point, polygon, color, width, pin, item };
    }
    function redraw() {
      if (!map || !library) return;
      const remaining = new Set();
      let rejected = 0;
      items.forEach(item => {
        const id = item.idElemento;
        remaining.add(id);
        let entry = overlays.get(id);
        // Filter changes retain unchanged native overlays and their handlers.
        if (entry && entry.item !== item) { clearOverlay(entry); overlays.delete(id); entry = null; }
        try {
          if (!entry) { entry = buildOverlay(item); if (entry) overlays.set(id, entry); }
          if (entry) applySelection(entry, id === selectedId);
          else rejected++;
        } catch(error) {
          if(entry) clearOverlay(entry);
          overlays.delete(id);
          rejected++;
        }
      });
      overlays.forEach((entry, id) => { if (!remaining.has(id)) { clearOverlay(entry); overlays.delete(id); } });
      dataStatus = { requested: items.length, rendered: overlays.size, failed: rejected, pending: false };
      container.dataset.elementosEsperados = String(items.length);
      container.dataset.elementosPreparados = String(overlays.size);
      container.dataset.elementosComFalha = String(rejected);
      onDataChange({ ...dataStatus });
    }
    async function initialize(view) {
      library = await loadLibraries(typeof apiKey === 'function' ? apiKey() : apiKey);
      if (!wanted) return false;
      if (authError) throw authError;
      if (!map) {
        map = new library.Map3DElement({ ...cameraFromView(view, height()), mode: 'HYBRID', fov: FOV, gestureHandling: 'COOPERATIVE', qualityMode: 'PERFORMANCE' });
        map.style.width = '100%'; map.style.height = '100%';
        map.setAttribute('aria-label', 'Mapa 3D dos elementos da obra');
        map.addEventListener('gmp-error', () => report(failure('rendering', messages.rendering)));
        map.addEventListener('gmp-map-id-error', () => report(failure('authentication', messages.authentication)));
        map.addEventListener('gmp-steadychange', event => {
          if (!event.isSteady || authError) return;
          clearTimeout(renderTimer);
          loaded = true; failed = false;
          if (readyResolve) { readyResolve(true); readyResolve = null; readyReject = null; }
          if (wanted) onReady();
        });
        container.append(map);
        redraw();
      }
      return true;
    }
    const controller = {
      async show(view) {
        const requestToken = ++visibilityToken;
        if (readyResolve) { readyResolve(false); readyResolve = null; readyReject = null; }
        clearTimeout(renderTimer);
        wanted = true;
        previousView = view || previousView || { center: { lat: -22.97, lng: -43.37 }, zoom: 12 };
        container.hidden = false;
        try {
          if (global.navigator?.onLine === false) throw failure('network', messages.network);
          if (!map) {
            if (!starting) starting = initialize(previousView).finally(() => { starting = null; });
            if (!(await starting) || !wanted || requestToken !== visibilityToken) return false;
          }
          if (authError) throw authError;
          const camera = cameraFromView(previousView, height(), map);
          if (map.flyCameraTo && !Number.isFinite(previousView.center.altitude)) {
            map.flyCameraTo({endCamera:{...camera,altitudeMode:'RELATIVE_TO_GROUND'},durationMillis:0});
          } else Object.assign(map, camera);
          if (loaded && !failed) { onReady(); return true; }
          return await new Promise((resolve, reject) => {
            readyResolve = resolve; readyReject = reject;
            clearTimeout(renderTimer);
            renderTimer = setTimeout(() => report(failure('rendering', messages.rendering)), TIMEOUT);
          });
        } catch (error) {
          const safeError = error.code ? error : failure('rendering', messages.rendering);
          if (!failed) { failed = true; if (wanted) onError(safeError); }
          throw safeError;
        }
      },
      hide() {
        visibilityToken++;
        wanted = false;
        container.hidden = true;
        clearTimeout(renderTimer);
        if (readyResolve) { readyResolve(false); readyResolve = null; readyReject = null; }
        if (map?.stopCameraAnimation) map.stopCameraAnimation();
      },
      setData(data, id) { items = Array.isArray(data) ? data : []; selectedId = id ?? null; redraw(); },
      getDataStatus() { return { ...dataStatus, requested: items.length }; },
      setSelected(id) {
        const previous = overlays.get(selectedId), next = overlays.get(id);
        selectedId = id ?? null;
        if (previous) applySelection(previous, false);
        if (next) applySelection(next, true);
      },
      getView() { return map ? viewFromCamera(map, height()) : previousView || null; },
      focus(item) {
        if (!map) return;
        const coords = path(item.coordenadasMapa);
        if (!coords.length) return;
        const south = Math.min(...coords.map(p => p.lat)), north = Math.max(...coords.map(p => p.lat));
        const west = Math.min(...coords.map(p => p.lng)), east = Math.max(...coords.map(p => p.lng));
        const center = { lat: (south + north) / 2, lng: (west + east) / 2, altitude: Number(map.center?.altitude) || 0 };
        const northSpan = (north - south) * 111320, eastSpan = (east - west) * 111320 * Math.cos(center.lat * Math.PI / 180);
        const span = Math.max(northSpan, eastSpan * height() / Math.max(180, container.clientWidth || 600));
        const range = item.tipoGeometrico === 'Point' ? Math.min(Number(map.range) || 500, 500) : Math.max(80, span * 1.6 / (2 * Math.tan(FOV * Math.PI / 360) * Math.max(.3, Math.cos((map.tilt || 0) * Math.PI / 180))));
        if (map.flyCameraTo) map.flyCameraTo({endCamera:{center:{...center,altitude:0},range,tilt:map.tilt,heading:map.heading,altitudeMode:'RELATIVE_TO_GROUND'},durationMillis:0});
        else Object.assign(map, { center, range });
      }
    };
    global.addEventListener('offline', () => { if (wanted) report(failure('network', messages.network)); });
    return controller;
  }
  global.CifipeMapa3D = Object.freeze({ create, cameraFromView, viewFromCamera });
})(window);
