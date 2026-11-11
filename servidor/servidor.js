// Serviço 24h: lê a configuração no Supabase, faz as leituras no admin, grava os resultados e avisa no Telegram.
const { log, sleep } = require('./lib/util');
const { criarSb } = require('./lib/sb');
const { criarTelegram } = require('./lib/telegram');
const { criarEstado, avaliarMeta } = require('./lib/estado');

const VERSAO = '2.0.0';
const ERROS_PARA_AVISAR = 3;

function criarServico({ bot, sb, tg, estado, admin, agora = () => Date.now() }) {
  const m = { proxima: 0, eraAtivo: false, pedidoVisto: undefined, testeVisto: undefined, errosSeguidos: 0, avisouErro: false, ultimaLimpeza: 0, rodando: false };
  const iso = (ms) => new Date(ms).toISOString();
  const avisar = async (cfg, texto) => {
    if (cfg.telegram_ativo === false || !tg.configurado) return;
    try { await tg.enviar(texto); } catch (e) { log('Telegram falhou:', e.message); }
  };

  async function leitura(cfg) {
    m.rodando = true;
    const intervalo = Math.min(60, Math.max(1, Number(cfg.intervalo_min) || 5)) * 60000;
    await sb.status({ rodando: true }).catch(() => {});
    try {
      if (!admin.user || !admin.pass) throw new Error('ADMIN_USER / ADMIN_PASS não definidos no servidor (.env)');
      const alvos = Array.isArray(cfg.alvos) ? cfg.alvos : [];
      const out = await bot.executar({ ...admin, alvos });
      const em = iso(agora());
      const linhas = []; const cartoes = []; const errosAlvo = [];

      for (const r of out.resultados) {
        const { alvo } = r;
        const meta = Math.max(0, Number(alvo.meta) || 0);
        if (r.erro) { errosAlvo.push(`${alvo.nome}: ${r.erro}`); cartoes.push({ id: alvo.id, nome: alvo.nome, evento: alvo.evento, meta, erro: r.erro }); continue; }
        const est = estado.de(alvo.id);
        const variacao = est.total == null ? 0 : r.total - est.total;
        const av = avaliarMeta(r.total, meta, est);
        estado.gravar(alvo.id, { total: r.total, alertado: av.alertado, metaAvisada: av.alertado ? meta : null });
        linhas.push({ em, alvo_id: alvo.id, alvo_nome: alvo.nome, total: r.total, variacao, total_geral: r.totalGeral, meta, detalhe: r.detalhe, categorias: r.categorias, por_evento: r.porEvento });
        cartoes.push({ id: alvo.id, nome: alvo.nome, evento: alvo.evento, meta, total: r.total, variacao, totalGeral: r.totalGeral, detalhe: r.detalhe, categorias: r.categorias, porEvento: r.porEvento, atingiu: meta > 0 && r.total >= meta });
        if (av.disparar) {
          log(`*** META ATINGIDA: ${alvo.nome} = ${r.total} (meta ${meta}) ***`);
          await sb.alerta({ em, alvo_id: alvo.id, alvo_nome: alvo.nome, total: r.total, meta, total_geral: r.totalGeral }).catch((e) => log('Erro ao gravar alerta:', e.message));
          await avisar(cfg, `🔔 META ATINGIDA\n${alvo.nome}\nLotes: ${r.total} (meta ${meta})\nTotal geral com cortesias: ${r.totalGeral}`);
        }
      }
      if (linhas.length) await sb.leituras(linhas);

      const erroTxt = errosAlvo.length ? errosAlvo.join(' | ') : null;
      m.proxima = agora() + intervalo;
      await sb.status({
        rodando: false, ultima_em: em, proxima_em: cfg.ativo ? iso(m.proxima) : null, modo: out.modo, ms: out.ms, periodo: out.periodo || null,
        resultados: cartoes, erro: erroTxt, erro_em: erroTxt ? em : null,
      });
      if (m.avisouErro && !erroTxt) await avisar(cfg, '✅ Monitor de lotes voltou a ler normalmente.');
      if (!erroTxt) { m.errosSeguidos = 0; m.avisouErro = false; } else await falhou(cfg, erroTxt, false);
    } catch (e) {
      log('ERRO na leitura:', e.message);
      m.proxima = agora() + Math.min(intervalo, 120000); // após erro, tenta de novo em até 2 min
      await sb.status({ rodando: false, proxima_em: cfg.ativo ? iso(m.proxima) : null, erro: e.message, erro_em: iso(agora()) }).catch(() => {});
      await falhou(cfg, e.message, true);
    } finally { m.rodando = false; }
  }

  async function falhou(cfg, msg) {
    m.errosSeguidos++;
    if (m.errosSeguidos >= ERROS_PARA_AVISAR && !m.avisouErro) {
      m.avisouErro = true;
      await avisar(cfg, `⚠️ Monitor de lotes com erro há ${m.errosSeguidos} leituras seguidas:\n${String(msg).slice(0, 500)}`);
    }
  }

  // Um passo do laço: batimento, comandos do app e leitura quando for a hora.
  async function passo() {
    const cfg = await sb.config();
    if (!cfg) throw new Error('lm_config vazio — rode o SQL de instalação no Supabase');
    const t = agora();
    await sb.status({ online_em: iso(t), versao: VERSAO, telegram_configurado: tg.configurado });

    // comandos do app: valem quando o valor MUDA (não depende do relógio do celular estar certo)
    const primeira = m.pedidoVisto === undefined;
    const pediuTeste = !primeira && (cfg.pedir_teste_em || null) !== m.testeVisto;
    const pedido = !primeira && (cfg.pedir_leitura_em || null) !== m.pedidoVisto;
    m.testeVisto = cfg.pedir_teste_em || null;
    m.pedidoVisto = cfg.pedir_leitura_em || null;
    if (pediuTeste) {
      if (!tg.configurado) await sb.status({ erro: 'Telegram: TELEGRAM_TOKEN / TELEGRAM_CHAT_ID não definidos no servidor', erro_em: iso(t) }).catch(() => {});
      else { try { await tg.enviar('✅ Teste do Monitor de Lotes: o Telegram está configurado.'); } catch (e) { log('Teste do Telegram falhou:', e.message); await sb.status({ erro: `Telegram: ${e.message}`, erro_em: iso(t) }).catch(() => {}); } }
    }

    const ligou = cfg.ativo && !m.eraAtivo; // acabou de ser ativado (ou o serviço acabou de subir): lê já
    m.eraAtivo = !!cfg.ativo;
    if (!cfg.ativo && !pedido) { if (m.proxima) { m.proxima = 0; await sb.status({ proxima_em: null }).catch(() => {}); } return 'pausado'; }
    if (pedido || ligou || t >= m.proxima) { await leitura(cfg); return 'leu'; }

    if (t - m.ultimaLimpeza > 24 * 3600000) { // 1x por dia: apaga leituras com mais de 90 dias
      m.ultimaLimpeza = t;
      await sb.limparAntigas(iso(t - 90 * 24 * 3600000)).catch((e) => log('Limpeza falhou:', e.message));
    }
    return 'aguardando';
  }
  return { passo, m };
}

async function main() {
  const falta = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'ADMIN_USER', 'ADMIN_PASS'].filter((k) => !process.env[k]);
  if (falta.length) { console.error('Faltam variáveis no .env:', falta.join(', ')); process.exit(1); }
  const bot = require('./bot');
  const servico = criarServico({
    bot,
    sb: criarSb({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY }),
    tg: criarTelegram({ token: process.env.TELEGRAM_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID, api: process.env.TELEGRAM_API_URL }),
    estado: criarEstado(bot.DATA),
    admin: { url: (process.env.ADMIN_URL || 'https://adm.pointdoingresso.com.br').replace(/\/$/, ''), user: process.env.ADMIN_USER, pass: process.env.ADMIN_PASS, year: process.env.ADMIN_YEAR || String(new Date().getFullYear()) },
  });
  log(`Monitor de Lotes ${VERSAO} iniciado`);
  let parar = false;
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { parar = true; log('Encerrando...'); setTimeout(() => process.exit(0), 3000).unref(); });
  while (!parar) {
    try { await servico.passo(); } catch (e) { log('ERRO no laço:', e.message); }
    await sleep(15000);
  }
}

if (require.main === module) main();
module.exports = { criarServico };
