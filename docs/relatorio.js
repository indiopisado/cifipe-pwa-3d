function canvasRelatorio(largura, altura) {
  const canvas = document.createElement('canvas'); canvas.width = largura; canvas.height = altura;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, largura, altura);
  return { canvas: canvas, ctx: ctx };
}

function graficoRelatorio(avancos) {
  const desenho = canvasRelatorio(1000, 340), ctx = desenho.ctx;
  // Diâmetro e espessura impressos 75% maiores: antes 65/22, a 510 px;
  // agora a imagem ocupa 680 px, compensando a largura na escala dos anéis.
  const ampliacao = 1.75 * 510 / 680, raio = 65 * ampliacao;
  ['agua', 'esgoto'].forEach(function(chave, indice) {
    if (avancos.modoAvanco === 'conexoes_t' && chave === 'esgoto') return;
    const dado = avancos[chave] || {}, x = 250 + indice * 500, y = 145;
    const percentual = avancos.completo && Number.isFinite(dado.percentual) ? dado.percentual : null;
    ctx.lineWidth = 22 * ampliacao; ctx.strokeStyle = '#edf1f4'; ctx.beginPath(); ctx.arc(x, y, raio, 0, Math.PI * 2); ctx.stroke();
    if (percentual !== null && percentual > 0) { ctx.strokeStyle = indice ? '#cd247a' : '#008d96'; ctx.beginPath(); ctx.arc(x, y, raio, -Math.PI / 2, -Math.PI / 2 + Math.min(100, percentual) * Math.PI / 50); ctx.stroke(); }
    ctx.fillStyle = '#202a34'; ctx.textAlign = 'center'; ctx.font = 'bold 34px Arial'; ctx.fillText(percentual === null ? '—' : percentual.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%', x, y + 11);
    ctx.fillStyle = indice ? '#cd247a' : '#008d96'; ctx.font = 'bold 25px Arial'; ctx.fillText(avancos.modoAvanco === 'conexoes_t' ? (indice ? '' : 'Conexões T (un.)') : indice ? 'Esgoto' : 'Água', x, 290);
  });
  return desenho.canvas.toDataURL('image/png');
}

function diagramaRelatorio(elementos) {
  elementos = elementos.filter(elementoIncluidoRelatorio);
  const desenho = canvasRelatorio(1100, 650), ctx = desenho.ctx;
  const coords = elementos.flatMap(function(item) { return item.coordenadasMapa || []; });
  ctx.fillStyle = '#222222'; ctx.font = '20px Arial'; ctx.fillText('Diagrama de localização · N ↑', 65, 30);
  if (!coords.length) { ctx.fillText('Nenhum elemento atende aos filtros.', 65, 100); return desenho.canvas.toDataURL('image/png'); }
  const limites = coords.reduce(function(box, c) { return { minLat: Math.min(box.minLat, c[0]), maxLat: Math.max(box.maxLat, c[0]), minLon: Math.min(box.minLon, c[1]), maxLon: Math.max(box.maxLon, c[1]) }; }, { minLat: Infinity, maxLat: -Infinity, minLon: Infinity, maxLon: -Infinity });
  const { minLat, maxLat, minLon, maxLon } = limites;
  // Projeção equiretangular local, com proporção corrigida pela latitude média.
  const fator = Math.max(.001, Math.cos((minLat + maxLat) * Math.PI / 360));
  const meioX = (minLon + maxLon) / 2, meioY = (minLat + maxLat) / 2;
  const escala = Math.min(940 / Math.max((maxLon - minLon) * fator, .0005), 470 / Math.max(maxLat - minLat, .0005));
  function xy(c) { return [550 + (c[1] - meioX) * fator * escala, 305 - (c[0] - meioY) * escala]; }
  ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1; ctx.font = '16px Arial';
  for (let i = 0; i <= 4; i++) {
    const x = 70 + i * 240, y = 70 + i * 120;
    ctx.beginPath(); ctx.moveTo(x, 65); ctx.lineTo(x, 545); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(70, y); ctx.lineTo(1030, y); ctx.stroke();
  }
  elementos.forEach(function(item, i) {
    const vertices = (item.coordenadasMapa || []).map(xy); if (!vertices.length) return;
    ctx.strokeStyle = normalizarValor(item.sistema) === 'agua' ? '#008d96' : normalizarValor(item.sistema) === 'esgoto' ? '#cd247a' : '#555555';
    ctx.fillStyle = '#b56e00'; ctx.lineWidth = 5; ctx.setLineDash(normalizarValor(item.status) === 'em execucao' ? [12, 7] : []);
    if (item.tipoGeometrico === 'Polygon') { ctx.strokeStyle = '#ff802f'; ctx.fillStyle = 'rgba(255,128,47,0)'; ctx.setLineDash([]); ctx.beginPath(); (item.aneisMapa || [item.coordenadasMapa]).forEach(function(ring) { ring.map(xy).forEach(function(v,j) { if (j) ctx.lineTo(v[0],v[1]); else ctx.moveTo(v[0],v[1]); }); ctx.closePath(); }); ctx.stroke(); }
    else if (item.tipoGeometrico === 'Point') { ctx.beginPath(); ctx.arc(vertices[0][0], vertices[0][1], 7, 0, Math.PI * 2); ctx.fill(); }
    else { ctx.beginPath(); vertices.forEach(function(v, j) { if (j) ctx.lineTo(v[0], v[1]); else ctx.moveTo(v[0], v[1]); }); ctx.stroke(); }
    ctx.setLineDash([]); ctx.font = 'bold 20px Arial'; ctx.fillStyle = '#222'; ctx.fillText(String(i + 1), vertices[0][0] + 10, vertices[0][1] - 10);
  });
  ctx.font = '18px Arial'; ctx.fillStyle = '#008d96'; ctx.fillText('Água', 80, 620); ctx.fillStyle = '#cd247a'; ctx.fillText('Esgoto', 200, 620); ctx.fillStyle = '#b56e00'; ctx.fillText('● Ponto', 330, 620); ctx.fillStyle = '#222'; ctx.fillText('Contínuo: Concluído · Tracejado: Em execução', 480, 620);
  return desenho.canvas.toDataURL('image/png');
}

async function mapaRelatorio(elementos, fundoSelecionado) {
  const fundo = fundosMapa[fundoSelecionado || tipoMapa];
  elementos = elementos.filter(elementoIncluidoRelatorio);
  const coords = elementos.flatMap(function(item) { return item.coordenadasMapa || []; });
  if (!coords.length) return diagramaRelatorio(elementos);
  // Prévia sem Leaflet e harness local mantêm o diagrama explicitamente identificado.
  if (!mapa || !mapa.latLngToContainerPoint) return diagramaRelatorio(elementos);
  mapa.invalidateSize();
  mapa.fitBounds(coords, { padding: [40, 40], maxZoom: 18, animate: false });
  const container = document.getElementById('mapa');
  let tiles = [], pendentes = true;
  const inicio = Date.now();
  // Somente os tiles do mapa visível; não buscar áreas/níveis adicionais.
  while (Date.now() - inicio < 4000) {
    await new Promise(function(resolve) { setTimeout(resolve, 150); });
    const box = container.getBoundingClientRect();
    const containerBase = camadaBase?.getContainer();
    if (!containerBase) return diagramaRelatorio(elementos);
    tiles = Array.from(containerBase.querySelectorAll('img.leaflet-tile')).filter(function(img) {
      const r = img.getBoundingClientRect();
      return r.right > box.left && r.left < box.right && r.bottom > box.top && r.top < box.bottom && img.classList.contains('leaflet-tile-loaded');
    });
    pendentes = Array.from(containerBase.querySelectorAll('img.leaflet-tile')).some(function(img) {
      const r=img.getBoundingClientRect();return r.right>box.left && r.left<box.right && r.bottom>box.top && r.top<box.bottom && (!img.complete || !img.naturalWidth);
    });
    if (tiles.length && !pendentes) break;
  }
  if (pendentes || !tiles.length || tiles.some(function(img) { return !img.complete || !img.naturalWidth; })) return diagramaRelatorio(elementos);
  const box = container.getBoundingClientRect(), fator = 1100 / box.width;
  const altura = Math.round(box.height * fator);
  const desenho = canvasRelatorio(1100, altura + 100), ctx = desenho.ctx;
  ctx.fillStyle='#222';ctx.font='22px Arial';ctx.fillText('Mapa da obra · N ↑', 25, 32);
  ctx.save();ctx.beginPath();ctx.rect(0,50,1100,altura);ctx.clip();
  for (const tile of tiles) {
    const r=tile.getBoundingClientRect();
    ctx.drawImage(tile,(r.left-box.left)*fator,50+(r.top-box.top)*fator,r.width*fator,r.height*fator);
  }
  function xy(c) { const pos=mapa.latLngToContainerPoint(c);return [pos.x*fator,50+pos.y*fator]; }
  const indices = new Map(elementos.map(function(item,i){return [item.idElemento,i+1];}));
  ordenarCamadasMapa(elementos).forEach(function(item) {
    const vertices=(item.coordenadasMapa || []).map(xy);if(!vertices.length)return;
    ctx.strokeStyle=item.tipoGeometrico==='Polygon'?'#ff802f':normalizarValor(item.sistema)==='agua'?'#008d96':normalizarValor(item.sistema)==='esgoto'?'#cd247a':'#555';
    ctx.lineWidth=item.tipoGeometrico==='Polygon'?3:5;ctx.setLineDash(item.tipoGeometrico==='LineString' && normalizarValor(item.status)==='em execucao'?[12,7]:[]);
    if(item.tipoGeometrico==='Point') {
      const referencia=item.simbolo && item.simbolo.src || '';const cor=referencia.match(/\/(red|yellow|green|blue|orange|purple|pink|white|black|gray|grey)_pin(?:_classic)?\.png$/i);
      const cores={red:'#e53935',yellow:'#ffd600',green:'#43a047',blue:'#1976d2',orange:'#ff8f00',purple:'#8e24aa',pink:'#ec407a',white:'#fff',black:'#212121',gray:'#9aa5b1',grey:'#9aa5b1'};
      ctx.fillStyle=cor?cores[cor[1].toLowerCase()]:'#9aa5b1';ctx.strokeStyle='#333';const v=vertices[0];
      ctx.beginPath();ctx.moveTo(v[0],v[1]);ctx.bezierCurveTo(v[0]-22,v[1]-25,v[0]-12,v[1]-38,v[0],v[1]-38);ctx.bezierCurveTo(v[0]+12,v[1]-38,v[0]+22,v[1]-25,v[0],v[1]);ctx.fill();ctx.stroke();
    } else {
      ctx.beginPath();const rings=item.tipoGeometrico==='Polygon'?(item.aneisMapa || [item.coordenadasMapa]):[item.coordenadasMapa];
      rings.forEach(function(ring){ring.map(xy).forEach(function(v,i){if(i)ctx.lineTo(v[0],v[1]);else ctx.moveTo(v[0],v[1]);});if(item.tipoGeometrico==='Polygon')ctx.closePath();});ctx.stroke();
    }
    ctx.setLineDash([]);ctx.font='bold 20px Arial';ctx.strokeStyle='#fff';ctx.lineWidth=4;ctx.fillStyle='#222';const n=String(indices.get(item.idElemento));ctx.strokeText(n,vertices[0][0]+12,vertices[0][1]-12);ctx.fillText(n,vertices[0][0]+12,vertices[0][1]-12);
  });
  ctx.restore();ctx.font='16px Arial';ctx.fillStyle='#222';ctx.fillText('Água: ciano · Esgoto: rosa · Pontos: pinos · Em execução: tracejado',20,altura+76);
  ctx.textAlign='right';ctx.font='12px Arial';ctx.fillText(fundo.credito,1080,altura+96,1060);
  try { return desenho.canvas.toDataURL('image/png'); }
  catch(erro) { return diagramaRelatorio(elementos); }
}

function prepararFotoRelatorio(foto) {
  if (!fotoSegura(foto)) return Promise.resolve(Object.assign({}, foto, { disponivel: false, src: '' }));
  return new Promise(function(resolve) {
    const img = new Image(); let concluido = false;
    function terminar(resultado) { if (concluido) return; concluido = true; clearTimeout(timer); resolve(resultado); }
    const timer = setTimeout(function() { terminar({ nome: foto.nome, titulo: foto.titulo, disponivel: false, src: '', aviso: 'Tempo de decodificação excedido.' }); }, 10000);
    img.onerror = function() { terminar({ nome: foto.nome, titulo: foto.titulo, disponivel: false, src: '', aviso: 'Fotografia não pôde ser decodificada.' }); };
    img.onload = function() {
      try {
        const escala = Math.min(1, 1200 / img.naturalWidth, 1200 / img.naturalHeight);
        const desenho = canvasRelatorio(Math.max(1, Math.round(img.naturalWidth * escala)), Math.max(1, Math.round(img.naturalHeight * escala)));
        desenho.ctx.fillStyle = '#ffffff'; desenho.ctx.fillRect(0, 0, desenho.canvas.width, desenho.canvas.height);
        desenho.ctx.drawImage(img, 0, 0, desenho.canvas.width, desenho.canvas.height);
        terminar({ nome: foto.nome, titulo: foto.titulo, disponivel: true, src: desenho.canvas.toDataURL('image/jpeg', .82) });
      } catch (erro) { terminar({ nome: foto.nome, titulo: foto.titulo, disponivel: false, src: '', aviso: 'Falha na preparação da fotografia.' }); }
    };
    img.src = foto.src;
  });
}

function elementoIncluidoRelatorio(item) {
  return ['LineString', 'Point'].indexOf(item.tipoGeometrico) >= 0 && ['planejado', 'pendente'].indexOf(normalizarValor(item.status)) < 0;
}

function habilitarRelatorio() {
  document.getElementById('botaoRelatorio').disabled = relatorioEmCurso || consultaDesatualizada
    || !leituraObra || !avancosGlobaisObra || !revisaoExibida;
}

function base64Relatorio(bytes) {
  let binario = '';
  for (let i = 0; i < bytes.length; i += 16384) binario += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(binario);
}

function ponteRelatorio() {
  if (typeof window.engedataSaveReport === 'function') return window.engedataSaveReport.bind(window);
  const pai = window.parent;
  if (!pai || pai === window) return null;
  try {
    if (pai.location.origin === location.origin && typeof pai.engedataSaveReport === 'function') {
      return pai.engedataSaveReport.bind(pai);
    }
  } catch {
    // Quadros externos não recebem o arquivo pela ponte do aplicativo.
  }
  return null;
}

async function baixarRelatorio(resposta, formato) {
  const mime = resposta.headers.get('content-type');
  const nomeCodificado = /filename\*=UTF-8''([^;]+)/i.exec(resposta.headers.get('content-disposition') || '')?.[1];
  const nome = nomeCodificado ? decodeURIComponent(nomeCodificado) : 'Relatorio_CIFIPE.' + formato;
  const bytes = new Uint8Array(await resposta.arrayBuffer());
  const salvarNoAplicativo = ponteRelatorio();
  if (salvarNoAplicativo) {
    if (bytes.length > 24 * 1024 * 1024) throw new Error('O relatório excede o tamanho aceito pelo aplicativo.');
    await salvarNoAplicativo({ nome, mime, base64: base64Relatorio(bytes) });
    return;
  }
  const android = navigator.userAgent.includes('ENGEDATAFIPE-Android/1');
  const url = android ? 'data:' + mime + ';base64,' + base64Relatorio(bytes) + '#' + encodeURIComponent(nome)
    : URL.createObjectURL(new Blob([bytes], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  link.remove();
  if (!android) setTimeout(function() { URL.revokeObjectURL(url); }, 60000);
}

async function fotosDoRelatorio(elementos, obra, revisao, escopo) {
  const comFotos = elementos.filter(function(item) { return (item.fotos || []).some(function(foto) { return foto.disponivel; }); });
  if (!comFotos.length) return new Map();
  if (escopo === 'atual') {
    const id = comFotos[0].idElemento;
    const fotos = await (fotosPorElemento.get(id) || consultarCifipe(endpointDetalhes, { obra, revisao, elemento: id }));
    return new Map([[id, fotos.data]]);
  }
  const consulta = await consultarCifipe(endpointDetalhes, { obra });
  if (consulta.revisao !== revisao) throw new Error('A obra foi atualizada. Recarregue a consulta e gere novamente.');
  return new Map(consulta.data.dados.map(function(item) { return [item.idElemento, item.fotos || []]; }));
}

async function gerarRelatorio() {
  if (document.getElementById('botaoRelatorio').disabled) return;
  const estado = document.getElementById('estadoRelatorio');
  const carga = versaoCarga;
  const obra = obraExibida;
  const revisao = revisaoExibida;
  const consulta = capturarConsulta();
  const formato = document.getElementById('formatoRelatorio').value;
  const escopo = document.getElementById('escopoRelatorio').value;
  const elementos = (escopo === 'global' ? dadosKMZCarregados : dadosExibidos.filter(function(item) {
    return item.idElemento === consulta.selecionado;
  })).filter(elementoIncluidoRelatorio);
  if (escopo === 'global') elementos.sort(function(a, b) {
    return (a.dataObra || '9999').localeCompare(b.dataObra || '9999');
  });
  estado.hidden = false;
  if (escopo === 'atual' && !elementos.length) {
    estado.textContent = 'Selecione um ponto ou trecho para gerar o relatório Atual.';
    return;
  }
  relatorioEmCurso = true;
  habilitarRelatorio();
  const centro = mapa.getCenter?.();
  const zoom = mapa.getZoom?.();
  const fundo = tipoMapa;
  const avancos = avancosGlobaisObra;
  document.querySelectorAll('[data-fundo]').forEach(function(botao) { botao.disabled = true; });
  estado.textContent = 'Preparando mapa e fotografias…';
  try {
    const [imagemMapa, fotos] = await Promise.all([
      mapaRelatorio(elementos, fundo),
      fotosDoRelatorio(elementos, obra, revisao, escopo),
    ]);
    if (carga !== versaoCarga || obra !== obraExibida) throw new Error('A obra mudou. Gere o relatório da nova consulta.');
    const itens = [];
    for (const item of elementos) {
      const preparadas = [];
      for (const foto of fotos.get(item.idElemento) || item.fotos || []) preparadas.push(await prepararFotoRelatorio(foto));
      itens.push({ idElemento: item.idElemento, fotos: preparadas });
    }
    if (carga !== versaoCarga || obra !== obraExibida) throw new Error('A obra mudou. Gere o relatório da nova consulta.');
    const corpo = JSON.stringify({
      obraId: obra, revisao, formato, escopo, elementos: itens, filtros: consulta.filtros,
      mapa: imagemMapa, grafico: graficoRelatorio(avancos),
    });
    if (new TextEncoder().encode(corpo).length > 8 * 1024 * 1024) throw new Error('Relatório muito grande. Selecione o escopo Atual.');
    estado.textContent = 'Gerando ' + formato.toUpperCase() + '…';
    const resposta = await fetch(endpointRelatorio, {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: corpo,
    });
    if (!resposta.ok) {
      const erro = await resposta.json().catch(function() { return null; });
      throw new Error(erro?.error || erro?.message || 'Não foi possível gerar o relatório.');
    }
    if (carga !== versaoCarga || obra !== obraExibida) throw new Error('A obra mudou. Gere o relatório da nova consulta.');
    await baixarRelatorio(resposta, formato);
    estado.textContent = 'Relatório ' + formato.toUpperCase() + ' pronto.';
  } catch (erro) {
    estado.textContent = 'Não foi possível gerar o relatório: ' + erro.message;
  } finally {
    if (centro && carga === versaoCarga && obra === obraExibida) mapa.setView(centro, zoom, { animate: false });
    relatorioEmCurso = false;
    habilitarRelatorio();
    document.querySelectorAll('[data-fundo]').forEach(function(botao) { botao.disabled = false; });
  }
}

