import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const codigo = readFileSync(new URL("../web/relatorio.js", import.meta.url), "utf8");
const local = { origin: "https://localhost" };
const mimePdf = "application/pdf";
const mimeDocx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function preparar({ pai, agente = "" } = {}) {
  const links = [];
  const janela = {};
  janela.parent = pai ?? janela;
  const baixar = runInNewContext(codigo + "\nbaixarRelatorio", {
    window: janela, location: local, navigator: { userAgent: agente }, btoa,
    document: { createElement: () => ({ click() { links.push(this); }, remove() {} }), body: { appendChild() {} } },
    URL: { createObjectURL: () => "blob:fixture", revokeObjectURL() {} }, Blob, setTimeout() {},
  });
  return { links, baixar };
}

function resposta(formato, mime, bytes) {
  return new Response(bytes, { headers: {
    "Content-Type": mime, "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent("Relatório da obra." + formato),
  } });
}

test("o dashboard embutido entrega PDF e DOCX à ponte do aplicativo com os bytes intactos", async () => {
  const salvos = [];
  const pai = { location: local, engedataSaveReport(report) { salvos.push(report); } };
  const { baixar, links } = preparar({ pai });
  for (const [formato, mime] of [["pdf", mimePdf], ["docx", mimeDocx]]) {
    const bytes = Uint8Array.from([0, 1, 127, 255]);
    await baixar(resposta(formato, mime, bytes), formato);
    const salvo = salvos.at(-1);
    assert.equal(salvo.mime, mime);
    assert.equal(salvo.nome, "Relatório da obra." + formato);
    assert.deepEqual(Buffer.from(salvo.base64, "base64"), Buffer.from(bytes));
  }
  assert.deepEqual(links, []);
});

test("a WebView legada recebe o arquivo pela URL data e um quadro externo usa download comum", async () => {
  const bytes = Uint8Array.from([37, 80, 68, 70, 45]);
  const android = preparar({ agente: "ENGEDATAFIPE-Android/1" });
  await android.baixar(resposta("pdf", mimePdf, bytes), "pdf");
  assert.equal(android.links[0].href, "data:application/pdf;base64,JVBERi0=#Relat%C3%B3rio%20da%20obra.pdf");
  const pai = { get location() { throw new Error("origem diferente"); }, engedataSaveReport() { assert.fail(); } };
  const web = preparar({ pai });
  await web.baixar(resposta("pdf", mimePdf, bytes), "pdf");
  assert.equal(web.links[0].href, "blob:fixture");
});
