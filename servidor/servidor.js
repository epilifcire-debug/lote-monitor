// Serviço 24h: lê a configuração no Supabase, faz as leituras no admin, grava os resultados e avisa no Telegram.
const { log, sleep } = require('./lib/util');
const { criarSb } = require('./lib/sb');
const { criarTelegram } = require('./lib/telegram');
const { criarEstado, avaliarMeta } = require('./lib/estado');

const fs = require('fs');
const path = require('path');
const VERSAO = '2.0.0';
const ERROS_PARA_AVISAR = 3;

// intervalo em ms: usa intervalo_seg (10 s a 1 h); sem ele, cai para intervalo_min (legado)
function intervaloMs(cfg) {
  const seg = Number(cfg.intervalo_seg);
  if (seg >= 10) return Math.min(3600, Math.floor(seg)) * 1000;
  return Math.min(60, Math.max(1, Number(cfg.intervalo_min) || 5)) * 60000;
}
const GRAVA_HISTORICO_A_CADA = 5 * 60000; // com leituras de 15-30 s, só guarda no histórico quando muda (ou a cada 5 min)
const RETENCAO_DIAS = 30;
const BACKUP_A_CADA_DIAS = 30;
const diaBR = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.TZ || 'America/Maceio', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)); // AAAA-MM-DD
const csvCel = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

function criarServico({ bot, sb, tg, estado, admin, pastaDados, agora = () => Date.now() }) {
  const m = { ultimoBatimento: 0, ultimaGravada: {}, proxima: 0, eraAtivo: false, pedidoVisto: undefined, testeVisto: undefined, errosSeguidos: 0, avisouErro: false, ultimaLimpeza: 0, rodando: false };
  const iso = (ms) => new Date(ms).toISOString();
  const avisar = async (cfg, texto) => {
    if (cfg.telegram_ativo === false || !tg.configurado) return;
    try { await tg.enviar(texto); } catch (e) { log('Telegram falhou:', e.message); }
  };

  async function leitura(cfg) {
    m.rodando = true;
    const intervalo = intervaloMs(cfg);
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
      const t0 = agora();
      const novas = linhas.filter((l) => {
        const u = m.ultimaGravada[l.alvo_id];
        const mudou = !u || u.total !== l.total || u.total_geral !== l.total_geral;
        if (mudou || t0 - u.t >= GRAVA_HISTORICO_A_CADA) { m.ultimaGravada[l.alvo_id] = { t: t0, total: l.total, total_geral: l.total_geral }; return true; }
        return false;
      });
      if (novas.length) await sb.leituras(novas);
      if (novas.length && sb.diario) { // resumo diário permanente: o último valor do dia de cada evento
        await sb.diario(novas.map((l) => ({ dia: diaBR(t0), alvo_id: l.alvo_id, alvo_nome: l.alvo_nome, total: l.total, total_geral: l.total_geral, meta: l.meta, atualizado_em: l.em }))).catch((e) => log('Resumo diário falhou:', e.message));
      }

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

  // Backup em CSV a cada 30 dias (arquivo em data/backups + Telegram) e, só depois dele, apaga leituras com mais de 30 dias
  async function manutencao(cfg, t) {
    if (!pastaDados || !sb.leiturasEntre) { await sb.limparAntigas(iso(t - RETENCAO_DIAS * 24 * 3600000)).catch(() => {}); return; }
    const arq = path.join(pastaDados, 'backup.json');
    let ate = null; try { ate = JSON.parse(fs.readFileSync(arq, 'utf8')).ate || null; } catch {}
    if (!ate || t - Date.parse(ate) >= BACKUP_A_CADA_DIAS * 24 * 3600000) {
      const de = ate || '2000-01-01T00:00:00.000Z';
      const linhas = await sb.leiturasEntre(de, iso(t));
      const csv = ['em,evento,total_lotes,variacao,total_geral,meta'].concat(linhas.map((l) => [l.em, l.alvo_nome || l.alvo_id, l.total, l.variacao, l.total_geral, l.meta].map(csvCel).join(','))).join('\n') + '\n';
      const nome = `leituras-${diaBR(Date.parse(de) || 0)}_a_${diaBR(t)}.csv`;
      fs.mkdirSync(path.join(pastaDados, 'backups'), { recursive: true });
      fs.writeFileSync(path.join(pastaDados, 'backups', nome), '\ufeff' + csv);
      log(`Backup salvo: backups/${nome} (${linhas.length} leituras)`);
      if (cfg.telegram_ativo !== false && tg.configurado) { try { await tg.enviarArquivo(nome, '\ufeff' + csv, `📦 Backup mensal do Monitor de Lotes (${linhas.length} leituras)`); } catch (e) { log('Backup no Telegram falhou:', e.message); } }
      ate = iso(t); fs.writeFileSync(arq, JSON.stringify({ ate }));
    }
    // nunca apaga o que ainda não foi para backup
    const corte = Math.min(t - RETENCAO_DIAS * 24 * 3600000, Date.parse(ate));
    await sb.limparAntigas(iso(corte));
  }

  // Um passo do laço: batimento, comandos do app e leitura quando for a hora.
  async function passo() {
    const cfg = await sb.config();
    if (!cfg) throw new Error('lm_config vazio — rode o SQL de instalação no Supabase');
    const t = agora();
    if (t - m.ultimoBatimento >= 15000) { m.ultimoBatimento = t; await sb.status({ online_em: iso(t), versao: VERSAO, telegram_configurado: tg.configurado }); }

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

    if (t - m.ultimaLimpeza > 24 * 3600000) { // 1x por dia: backup mensal e limpeza do histórico detalhado
      m.ultimaLimpeza = t;
      await manutencao(cfg, t).catch((e) => log('Manutenção falhou:', e.message));
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
    pastaDados: bot.DATA,
    admin: { url: (process.env.ADMIN_URL || 'https://adm.pointdoingresso.com.br').replace(/\/$/, ''), user: process.env.ADMIN_USER, pass: process.env.ADMIN_PASS, year: process.env.ADMIN_YEAR || String(new Date().getFullYear()) },
  });
  log(`Monitor de Lotes ${VERSAO} iniciado`);
  let parar = false;
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { parar = true; log('Encerrando...'); setTimeout(() => process.exit(0), 3000).unref(); });
  while (!parar) {
    try { await servico.passo(); } catch (e) { log('ERRO no laço:', e.message); }
    await sleep(5000);
  }
}

if (require.main === module) main();
module.exports = { criarServico, intervaloMs };
