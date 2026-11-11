// Testa o serviço com Supabase, Telegram e robô de mentira (regras de meta, variação, erros e comandos do app).
const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const http = require('http');
const { criarServico } = require('../servidor');
const { criarEstado, avaliarMeta } = require('../lib/estado');
const { criarSb } = require('../lib/sb');
const { criarTelegram } = require('../lib/telegram');

const ALVO = { id: 'vumbora', nome: 'Bloco Vumbora', evento: 'X', lotes: ['L'], meta: 200 };
const res = (total, tg = 5000) => ({ alvo: ALVO, total, totalGeral: tg, detalhe: [{ lote: 'L', qtd: total, encontrado: true }], categorias: [], porEvento: [] });

(async () => {
  // regra da meta
  assert.deepStrictEqual(avaliarMeta(199, 200, {}), { disparar: false, alertado: false });
  assert.deepStrictEqual(avaliarMeta(200, 200, {}), { disparar: true, alertado: true });
  assert.deepStrictEqual(avaliarMeta(230, 200, { alertado: true, metaAvisada: 200 }), { disparar: false, alertado: true });
  assert.deepStrictEqual(avaliarMeta(230, 220, { alertado: true, metaAvisada: 200 }), { disparar: true, alertado: true }, 'meta alterada avisa de novo');
  assert.deepStrictEqual(avaliarMeta(150, 200, { alertado: true, metaAvisada: 200 }), { disparar: false, alertado: false });
  assert.deepStrictEqual(avaliarMeta(999, 0, {}), { disparar: false, alertado: false });

  let t = 1_800_000_000_000;
  const banco = { cfg: { id: 1, ativo: true, intervalo_min: 5, alvos: [ALVO], telegram_ativo: true, pedir_leitura_em: null, pedir_teste_em: null }, status: {}, leituras: [], alertas: [] };
  const sb = { config: async () => banco.cfg, status: async (c) => { Object.assign(banco.status, c); }, leituras: async (l) => { banco.leituras.push(...l); }, alerta: async (a) => { banco.alertas.push(a); }, limparAntigas: async () => {} };
  const msgs = []; const tg = { configurado: true, enviar: async (x) => { msgs.push(x); return true; } };
  let proximo = () => ({ resultados: [res(150)], modo: 'montado', ms: 9000, periodo: 'a à b' }); let chamadas = 0;
  const bot = { executar: async (c) => { chamadas++; assert.strictEqual(c.user, 'u'); return proximo(); } };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-svc-'));
  const svc = criarServico({ bot, sb, tg, estado: criarEstado(dir), admin: { url: 'http://x', user: 'u', pass: 'p', year: '2026' }, agora: () => t });

  assert.strictEqual(await svc.passo(), 'leu', 'lê assim que sobe');
  assert.strictEqual(banco.leituras[0].total, 150); assert.strictEqual(banco.leituras[0].variacao, 0); assert.strictEqual(banco.leituras[0].total_geral, 5000);
  assert.strictEqual(banco.status.resultados[0].total, 150); assert.strictEqual(banco.status.modo, 'montado'); assert.ok(banco.status.online_em);
  assert.strictEqual(banco.status.erro, null); assert.strictEqual(banco.status.rodando, false);

  t += 60_000; assert.strictEqual(await svc.passo(), 'aguardando', 'respeita o intervalo'); assert.strictEqual(chamadas, 1);

  // "Ler agora" pelo app
  banco.cfg.pedir_leitura_em = 'qualquer-valor-novo'; proximo = () => ({ resultados: [res(180)], modo: 'rapido', ms: 300 });
  assert.strictEqual(await svc.passo(), 'leu'); assert.strictEqual(banco.leituras[1].variacao, 30);
  assert.strictEqual(await svc.passo(), 'aguardando', 'o mesmo pedido não repete');

  // meta atingida: 1 alerta + 1 Telegram, e não repete
  t += 5 * 60_000; proximo = () => ({ resultados: [res(205)], modo: 'rapido', ms: 300 });
  await svc.passo(); assert.strictEqual(banco.alertas.length, 1); assert.strictEqual(banco.alertas[0].total, 205); assert.ok(/META ATINGIDA/.test(msgs[0]));
  assert.strictEqual(banco.status.resultados[0].atingiu, true);
  t += 5 * 60_000; proximo = () => ({ resultados: [res(210)], modo: 'rapido', ms: 300 });
  await svc.passo(); assert.strictEqual(banco.alertas.length, 1, 'não repete o alerta'); assert.strictEqual(msgs.length, 1);

  // serviço reinicia: lembra que já avisou (estado em disco)
  const svc2 = criarServico({ bot, sb, tg, estado: criarEstado(dir), admin: { url: 'http://x', user: 'u', pass: 'p' }, agora: () => t });
  await svc2.passo(); assert.strictEqual(banco.alertas.length, 1, 'reinício não reenvia alerta');

  // 3 erros seguidos => 1 aviso; ao voltar => aviso de recuperação
  proximo = () => { throw new Error('admin fora do ar'); };
  for (let i = 0; i < 4; i++) { t += 5 * 60_000; await svc2.passo(); }
  assert.strictEqual(banco.status.erro, 'admin fora do ar'); assert.strictEqual(msgs.filter((x) => /com erro/.test(x)).length, 1);
  assert.strictEqual(banco.status.resultados[0].total, 210, 'mantém os últimos números no app durante o erro');
  proximo = () => ({ resultados: [res(212)], modo: 'montado', ms: 9000 });
  t += 5 * 60_000; await svc2.passo(); assert.ok(/voltou/.test(msgs[msgs.length - 1])); assert.strictEqual(banco.status.erro, null);

  // erro só em um alvo: o outro é gravado normalmente
  const B = { id: 'camarote', nome: 'Camarote', evento: 'Y', lotes: ['A'], meta: 300 };
  banco.cfg.alvos = [ALVO, B]; const n = banco.leituras.length;
  proximo = () => ({ resultados: [res(213), { alvo: B, erro: 'Nenhum lote encontrado' }], modo: 'rapido', ms: 1 });
  t += 5 * 60_000; await svc2.passo();
  assert.strictEqual(banco.leituras.length, n + 1); assert.ok(/Camarote: Nenhum lote/.test(banco.status.erro)); assert.strictEqual(banco.status.resultados[1].erro, 'Nenhum lote encontrado');

  // pausado: não lê; teste de Telegram pelo app; Telegram desligado no app não envia
  banco.cfg.ativo = false; const c0 = chamadas; t += 10 * 60_000;
  assert.strictEqual(await svc2.passo(), 'pausado'); assert.strictEqual(chamadas, c0); assert.strictEqual(banco.status.proxima_em, null);
  banco.cfg.pedir_teste_em = 'novo'; await svc2.passo(); assert.ok(/Teste/.test(msgs[msgs.length - 1]));
  banco.cfg.ativo = true; banco.cfg.telegram_ativo = false; banco.cfg.alvos = [{ ...ALVO, meta: 100 }]; const q = msgs.length;
  proximo = () => ({ resultados: [{ ...res(214), alvo: banco.cfg.alvos[0] }], modo: 'rapido', ms: 1 });
  await svc2.passo(); assert.strictEqual(banco.alertas.length, 2, 'meta nova gera alerta no app'); assert.strictEqual(msgs.length, q, 'Telegram desligado no app');

  // clientes reais (sb e telegram) contra servidores HTTP de mentira
  const pedidos = [];
  const srv = http.createServer((req, r) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
    pedidos.push({ m: req.method, u: req.url, h: req.headers, b });
    if (req.url.startsWith('/rest/v1/lm_config')) { r.writeHead(200, { 'Content-Type': 'application/json' }); return r.end(JSON.stringify([{ id: 1, ativo: true }])); }
    if (req.url.includes('quebra')) { r.writeHead(401); return r.end('{"message":"nao"}'); }
    r.writeHead(req.url.startsWith('/bot') ? 200 : 204); r.end(req.url.startsWith('/bot') ? '{"ok":true}' : '');
  }); });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const real = criarSb({ url: base + '/', key: 'CHAVE' });
  assert.deepStrictEqual(await real.config(), { id: 1, ativo: true });
  await real.status({ rodando: true }); await real.leituras([{ total: 1 }]); await real.alerta({ total: 1 }); await real.limparAntigas('2026-01-01T00:00:00.000Z');
  assert.deepStrictEqual(pedidos.map((p) => `${p.m} ${p.u.split('?')[0]}`), ['GET /rest/v1/lm_config', 'PATCH /rest/v1/lm_status', 'POST /rest/v1/lm_leituras', 'POST /rest/v1/lm_alertas', 'DELETE /rest/v1/lm_leituras']);
  assert.ok(pedidos.every((p) => p.h.apikey === 'CHAVE' && p.h.authorization === 'Bearer CHAVE'));
  assert.strictEqual(pedidos[1].u, '/rest/v1/lm_status?id=eq.1');
  const tgReal = criarTelegram({ token: 'TK', chatId: '42', api: base });
  assert.strictEqual(await tgReal.enviar('oi'), true); const ult = pedidos[pedidos.length - 1];
  assert.strictEqual(ult.u, '/botTK/sendMessage'); assert.deepStrictEqual(JSON.parse(ult.b).chat_id, '42');
  assert.strictEqual(await criarTelegram({}).enviar('x'), false);
  srv.close();
  console.log('servico ok');
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
