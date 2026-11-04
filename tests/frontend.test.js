// Carrega static/app.js com um navegador de mentira e testa as funções puras. Rode: node --test tests/
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const falso = () => new Proxy(function () {}, {
  get: (_, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : falso()),
  apply: () => falso(),
  construct: () => falso(),
  set: () => true,
});
const ctx = vm.createContext({
  console: { log() {}, warn() {}, error() {} },
  document: falso(), navigator: falso(), localStorage: falso(), location: falso(), crypto: falso(),
  fetch: () => new Promise(() => {}), setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  requestAnimationFrame: () => 0, cancelAnimationFrame() {}, confirm: () => true, prompt: () => null,
  idbGet: async () => null, idbPut: async () => {}, idbGetAll: async () => [], idbDelete: async () => {},
  URL, URLSearchParams, Blob: function () {}, Promise, JSON, Math, Date, Set, Object, Array, String, RegExp, parseFloat, parseInt, isNaN,
});
ctx.window = ctx;
ctx.addEventListener = () => {};
vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8'), ctx);
const paraJS = v => JSON.parse(JSON.stringify(v));

test('reconhece linhas de acordes e não confunde letra', () => {
  for (const l of ['G  Em  Bm', 'Bm7(5-)  E7', 'C#º G/D', 'D7(9)', 'Am7. Bbo', '| G | % |']) assert.ok(ctx.isChordLine(l), l);
  for (const l of ['Bate, bate coração', 'Oi, tum']) assert.ok(!ctx.isChordLine(l), l);
});

test('parseCifra junta acordes com a letra de baixo e guarda seções', () => {
  const c = paraJS(ctx.parseCifra('[Intro]\nG  D\n\n[Verso]\nG   E7\nBate coração\nSó letra'));
  assert.deepStrictEqual(c, [
    { secao: 'Intro', acordes: 'G  D', letra: '' },
    { secao: 'Verso', acordes: 'G   E7', letra: 'Bate coração' },
    { secao: '', acordes: '', letra: 'Só letra' },
  ]);
});

test('parseCifra ignora caracteres invisíveis', () => {
  const c = paraJS(ctx.parseCifra('\u200bG   E7\n\u200bBate coração'));
  assert.deepStrictEqual(c, [{ secao: '', acordes: 'G   E7', letra: 'Bate coração' }]);
});

test('texto da cifra volta igual depois de ir e voltar', () => {
  const c = [{ secao: 'Verso', acordes: '  G   D', letra: 'Bate coração' }, { secao: 'Refrão', acordes: 'C', letra: '' }];
  assert.deepStrictEqual(paraJS(ctx.parseCifra(ctx.cifraParaTexto(c))), c);
});

test('grade pega a música inteira mesmo com acordes salvos como letra', () => {
  const grade = paraJS(ctx.gerarGradeDaCifra([
    { secao: 'Intro', acordes: 'G  Em  Bm  C  D', letra: '' },
    { secao: 'Verso', acordes: '', letra: '\u200bG    E7' },
    { secao: '', acordes: '', letra: '\u200bBate coração' },
    { secao: 'Refrão', acordes: '', letra: 'C    G' },
    { secao: '', acordes: '', letra: 'Oi tum' },
  ]));
  assert.deepStrictEqual(grade, [
    { nome_secao: 'Intro', grid: [['G', 'Em', 'Bm', 'C'], ['D', '%', '%', '%']] },
    { nome_secao: 'Verso', grid: [['G', 'E7', '%', '%']] },
    { nome_secao: 'Refrão', grid: [['C', 'G', '%', '%']] },
  ]);
});

test('grade não repete seção idêntica e numera as diferentes', () => {
  const v = (secao, acordes) => ({ secao, acordes, letra: 'x' });
  const nomes = paraJS(ctx.gerarGradeDaCifra([v('Verso', 'G D'), v('Refrão', 'C'), v('Verso', 'A E'), v('Refrão', 'C')]))
    .map(s => s.nome_secao);
  assert.deepStrictEqual(nomes, ['Verso', 'Refrão', 'Verso 2']);
});

test('transposição mantém a coluna de cada acorde', () => {
  const l = ctx.transporLinhaAlinhada('G       D7/F#   Am', 2);
  assert.deepStrictEqual(l.split(/\s+/), ['A', 'E7/G#', 'Bm']);
  assert.strictEqual(l.indexOf('E7/G#'), 8);
});

test('transposição do palco', () => {
  assert.strictEqual(ctx.jsTranspoeAcorde('Am7', 2), 'Bm7');
  assert.strictEqual(ctx.jsTranspoeAcorde('D7/F#', 2), 'E7/G#');
});

test('duplicadas: ignora acento, caixa e parênteses e põe a mais completa primeiro', () => {
  assert.strictEqual(ctx.chaveTitulo('Coração (Ao Vivo)'), ctx.chaveTitulo('CORACAO'));
  const grupos = paraJS(ctx.gruposDuplicadas([
    { id: 'a', titulo: 'Coração', cifra_json: '[]' },
    { id: 'b', titulo: 'coracao', cifra_json: '[{"letra":"x"}]' },
    { id: 'c', titulo: 'Outra', cifra_json: '[]' },
  ]));
  assert.deepStrictEqual(grupos.map(g => g.map(m => m.id)), [['b', 'a']]);
});
