# C.I.FIPE 3D — PWA de consulta

Dashboard publico para acompanhamento de obras de saneamento: filtros, indicadores, mapas Local/Satelite/3D, selecao dos elementos vistoriados, fotografias e relatorios PDF/DOCX.

Este repositorio contem somente a PWA de consulta. A area de operador de campo continua na hospedagem anterior, pois depende de um servidor para recebimento de arquivos. GitHub Pages hospeda os arquivos estaticos desta interface; dados, fotografias e geracao de relatorios continuam nos servicos existentes. Nao ha uma copia das obras ou fotografias neste repositorio.

## Compilar e verificar

Requer Node.js 22.12 ou superior. Nao ha dependencias a instalar.

```sh
npm test
npm run build
```

O build gera `docs/`, compativel tanto com dominio raiz quanto com subpasta do GitHub Pages. Publique a branch `main`, pasta `/docs`, em Settings > Pages. O arquivo `.nojekyll` desativa transformacoes do Jekyll. A publicacao no GitHub nao altera as versoes anteriores no Sites.

## Google Maps

A chave web do Google Maps e publica por natureza no HTML. Proteja-a no Google Cloud com restricao para **Maps JavaScript API** e pelos sites exatos usados. Para o endereco GitHub Pages da conta `indiopisado`, adicione `https://indiopisado.github.io/*` sem remover a origem anterior. O navegador pode enviar apenas a origem no referenciador, portanto nao dependa de restricao por subpasta. Nao publique credenciais de servidor ou arquivos `.env`.

Se precisar substituir a chave, use `GOOGLE_MAPS_API_KEY` em `.env.local`, recompile e publique `docs/` novamente. A biblioteca Google e solicitada somente ao tocar em 3D. O cache da PWA nao guarda mapas Google, fotos nem respostas do backend. O 3D e a consulta atualizada exigem internet.

## Instalar e compartilhar

Compartilhe o endereco HTTPS mostrado por Settings > Pages. No Android, use o botao Instalar PWA quando disponivel ou o menu do navegador. No iPhone/iPad, abra no Safari e use Compartilhar > Adicionar a Tela de Inicio. A instalacao, selecao/fotos, filtros e relatorios devem ser conferidos no aparelho que sera utilizado.

Validacao funcional informada pelo usuario em 19/11/2026 para a versao de origem: relatorios, filtros, mapa 3D e atualizacao dos elementos. A migracao de hospedagem requer conferir o novo dominio Google e a instalacao apos a publicacao.
