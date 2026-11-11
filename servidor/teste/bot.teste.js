// Teste de ponta a ponta do robô contra o admin falso (precisa de um Chrome/Chromium: PUPPETEER_EXECUTABLE_PATH).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-teste-'));
const { criar } = require('./admin-falso');

const ALVOS = [
  { id: 'vumbora', nome: 'Bloco Vumbora Sábado', evento: '[14/11/2026] BLOCO VUMBORA SABADO (14/11)', lotes: ['LOTE EXTRA BANESE CARD VUMBORA 14/11'], totalGeralEventos: ['BLOCO VUMBORA SABADO (14/11)', 'BLOCO VUMBORA PACOTE'], meta: 200 },
  { id: 'camarote', nome: 'Camarote Aju Sexta', evento: '[13/11/2026] CAMAROTE AJU SEXTA (13/11)', lotes: ['LOTE EXTRA EXCLUSIVO BANESE CARD INTEIRA', 'LOTE EXTRA EXCLUSIVO BANESE CARD MEIA', 'LOTE EXTRA EXCLUSIVO BANESE CARD SOLIDARIA'], totalGeralEventos: [], meta: 300 },
];

(async () => {
  for (const semEspacos of [false, true]) {
    const admin = criar({ semEspacos });
    const url = await admin.ouvir();
    const bot = require('../bot');
    bot.esquecerSessao();
    const cfg = { url, user: 'eric', pass: 'segredo', year: '2026', alvos: ALVOS };

    // 1ª leitura: navegador (login + chave Com Cortesia + 3 eventos em 2 páginas + Gerar Relatório)
    let r = await bot.executar(cfg);
    assert.strictEqual(r.modo, 'montado', 'primeira leitura monta pelo navegador');
    const post = new URLSearchParams(admin.st.ultimoPost);
    assert.strictEqual(post.get('comCortesia'), '1', 'chave Com Cortesia ligada');
    assert.deepStrictEqual(post.get('eventos').split(',').map(Number).sort((a, b) => a - b), [1, 13, 17], 'marcou exatamente os 3 eventos');
    let [v, c] = r.resultados;
    assert.strictEqual(v.total, 312); assert.strictEqual(v.totalGeral, 430 + 3292 + 1094 + 210);
    assert.deepStrictEqual(v.porEvento.map((e) => e.qtd), [4816, 210]);
    assert.strictEqual(c.total, 140 + 88 + 41); assert.strictEqual(c.totalGeral, 95 + 969);
    assert.strictEqual(v.categorias.find((x) => x.nome === 'PACOTE').qtd, 1094 + 210);
    assert.strictEqual(admin.st.logins, 1);

    // 2ª leitura: rápida, sem navegador e sem novo login, com número atualizado
    admin.st.vendasExtra = 330;
    const antes = admin.st.relatorios;
    r = await bot.executar(cfg);
    assert.strictEqual(r.modo, 'rapido', 'segunda leitura é rápida');
    assert.strictEqual(admin.st.logins, 1, 'não fez login de novo');
    assert.strictEqual(admin.st.relatorios, antes + 1);
    assert.strictEqual(r.resultados[0].total, 330); assert.strictEqual(r.resultados[0].totalGeral, 4816 + 18 + 210);
    assert.ok(r.ms < 3000, 'leitura rápida em menos de 3 s');

    // sessão do admin caiu: percebe e monta de novo sozinho
    admin.st.sessoes.clear();
    r = await bot.executar(cfg);
    assert.strictEqual(r.modo, 'montado'); assert.strictEqual(admin.st.logins, 2);
    assert.strictEqual(r.resultados[0].total, 330);

    // virou o dia: o relatório salvo termina "ontem" => remonta para não perder as vendas de hoje
    const sess = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'sessao.json'), 'utf8'));
    assert.ok(!sess.cookie.includes('segredo') && !JSON.stringify(sess).includes('segredo'), 'a senha não vai para o arquivo de sessão');
    fs.writeFileSync(path.join(process.env.DATA_DIR, 'sessao.json'), JSON.stringify({ ...sess, dia: '01/01/2020' }));
    delete require.cache[require.resolve('../bot')];
    const bot2 = require('../bot');
    r = await bot2.executar(cfg);
    assert.strictEqual(r.modo, 'montado', 'dia diferente remonta');

    // mudou a lista de eventos: remonta com a seleção nova
    r = await bot2.executar({ ...cfg, alvos: [ALVOS[1]] });
    assert.strictEqual(r.modo, 'montado');
    assert.deepStrictEqual(new URLSearchParams(admin.st.ultimoPost).get('eventos'), '17');
    assert.strictEqual(r.resultados[0].totalGeral, 1064);

    // senha errada: erro claro
    bot2.esquecerSessao(); admin.st.sessoes.clear();
    await assert.rejects(() => bot2.executar({ ...cfg, pass: 'errada' }), /Login falhou/);

    admin.srv.close();
    delete require.cache[require.resolve('../bot')];
    console.log(`bot ok (${semEspacos ? 'HTML sem espaços entre células' : 'HTML normal'})`);
  }
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
