(() => {
'use strict';
const CFG = window.LM_CONFIG || {};
const TZ = 'America/Maceio';
const OFFLINE_APOS_S = 120; // servidor sem batimento há mais que isto = offline

/* ---------- utilidades ---------- */
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'value') e.value = v;
    else if (k === 'checked') e.checked = !!v;
    else if (k === 'disabled') e.disabled = !!v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const trocar = (el, ...kids) => el.replaceChildren(...kids.flat().filter((c) => c != null && c !== false));
const svgEl = (tag, attrs) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); return e; };
const fmtN = (n) => (n == null ? '–' : Number(n).toLocaleString('pt-BR'));
const fmtData = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '–');
const fmtHora = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '–');
const ha = (iso) => {
  if (!iso) return 'nunca';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `há ${Math.round(s)} s`;
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  return `há ${Math.round(s / 86400)} d`;
};
const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const linhas = (t) => String(t || '').split('\n').map((x) => x.trim()).filter(Boolean);
const guarda = { ler: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, gravar: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const traduzErro = (m) => {
  m = String(m || '');
  if (/invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/email not confirmed/i.test(m)) return 'E-mail ainda não confirmado.';
  if (/failed to fetch|networkerror|load failed/i.test(m)) return 'Sem conexão com o servidor. Verifique a internet.';
  if (/too many requests|rate limit/i.test(m)) return 'Muitas tentativas. Aguarde um pouco e tente de novo.';
  return m;
};

/* ---------- estado ---------- */
const S = { sb: null, user: null, papel: null, tab: 'painel', config: null, status: null, alertas: [], leituras: [], maxAlertaId: null, hAlvo: null, users: null, ultimaLeitura: null, canal: null, timer: null, tick: null };
const root = document.getElementById('app');

/* ---------- alarme sonoro (só toca com o app aberto) ---------- */
const Alarme = {
  ctx: null, loop: null, ligado: false,
  somAtivo: () => guarda.ler('lm_som') !== '0',
  liberar() {
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch {}
  },
  pronto() { return !!this.ctx && this.ctx.state === 'running'; },
  bip() {
    if (!this.pronto()) return;
    const t = this.ctx.currentTime;
    [[880, 0], [1175, 0.22], [880, 0.44], [1175, 0.66]].forEach(([f, d]) => {
      const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
      o.type = 'square'; o.frequency.value = f; o.connect(g); g.connect(this.ctx.destination);
      g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.25, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.18);
      o.start(t + d); o.stop(t + d + 0.2);
    });
  },
  tocar(vezes = 1) { this.liberar(); for (let i = 0; i < vezes; i++) setTimeout(() => this.bip(), i * 1000); },
  iniciar() {
    if (this.ligado) return;
    this.ligado = true;
    if (this.somAtivo()) { this.bip(); this.loop = setInterval(() => this.bip(), 1500); }
    if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]);
  },
  parar() { this.ligado = false; clearInterval(this.loop); this.loop = null; if (navigator.vibrate) navigator.vibrate(0); },
};
document.addEventListener('pointerdown', () => Alarme.liberar(), { passive: true });

function mostrarAlarme(a) {
  const el = document.getElementById('alarme');
  if (!el) return;
  trocar(el, h('div', { class: 'caixa' },
    h('div', { class: 'ico', text: '🔔' }),
    h('h2', { text: 'META ATINGIDA' }),
    h('p', { text: a.alvo_nome || a.alvo_id }),
    h('p', { text: `Lotes: ${fmtN(a.total)} (meta ${fmtN(a.meta)})` }),
    a.total_geral != null ? h('p', { text: `Total geral com cortesias: ${fmtN(a.total_geral)}` }) : null,
    h('div', { class: 'actions' }, h('button', { class: 'b pri', onclick: () => { Alarme.parar(); el.classList.remove('on'); }, text: 'Parar alarme' }))));
  el.classList.add('on');
  Alarme.iniciar();
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      const titulo = `Meta atingida: ${a.alvo_nome || a.alvo_id}`; const corpo = `Lotes ${a.total} (meta ${a.meta})`;
      navigator.serviceWorker?.ready.then((r) => r.showNotification(titulo, { body: corpo, icon: 'icon-192.png', tag: 'meta-' + a.id })).catch(() => new Notification(titulo, { body: corpo }));
    }
  } catch {}
}

/* ---------- dados ---------- */
const erroDe = (r) => { if (r.error) throw new Error(r.error.message || 'Erro'); return r.data; };
async function carregarConfig() { S.config = erroDe(await S.sb.from('lm_config').select('*').eq('id', 1).maybeSingle()); }
async function carregarStatus() { S.status = erroDe(await S.sb.from('lm_status').select('*').eq('id', 1).maybeSingle()); }
async function carregarAlertas() {
  S.alertas = erroDe(await S.sb.from('lm_alertas').select('*').order('id', { ascending: false }).limit(20)) || [];
  const max = S.alertas.length ? S.alertas[0].id : 0;
  if (S.maxAlertaId == null) { S.maxAlertaId = max; return; } // primeira carga: não toca alarme por alerta antigo
  const novos = S.alertas.filter((a) => a.id > S.maxAlertaId);
  if (novos.length) { S.maxAlertaId = max; mostrarAlarme(novos[0]); }
}
async function carregarLeituras() {
  let q = S.sb.from('lm_leituras').select('*').order('em', { ascending: false }).limit(300);
  if (S.hAlvo) q = q.eq('alvo_id', S.hAlvo);
  S.leituras = erroDe(await q) || [];
}
const servidorOnline = () => !!S.status?.online_em && (Date.now() - Date.parse(S.status.online_em)) / 1000 < OFFLINE_APOS_S;

let atualizando = false; let pendente = false;
async function atualizar() {
  if (atualizando) { pendente = true; return; }
  atualizando = true;
  try {
    const antes = S.status?.ultima_em;
    await Promise.all([carregarStatus(), carregarAlertas(), S.tab === 'painel' ? carregarConfig() : Promise.resolve()]);
    if (S.tab === 'historico' && S.status?.ultima_em !== antes) { await carregarLeituras(); }
    S.erroRede = null;
  } catch (e) { S.erroRede = traduzErro(e.message); }
  finally { atualizando = false; }
  pintarCabecalho();
  if (S.tab === 'painel') pintarPainel();
  if (S.tab === 'historico') pintarHistorico();
  if (pendente) { pendente = false; setTimeout(atualizar, 300); }
}
let deb = null;
const atualizarDebounce = () => { clearTimeout(deb); deb = setTimeout(atualizar, 700); };

function iniciarTempoReal() {
  try {
    S.canal = S.sb.channel('lm')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lm_status' }, atualizarDebounce)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lm_alertas' }, atualizarDebounce)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lm_config' }, atualizarDebounce)
      .subscribe();
  } catch {}
  clearInterval(S.timer); S.timer = setInterval(atualizar, 20000); // plano B caso o tempo real falhe
  clearInterval(S.tick); S.tick = setInterval(() => { pintarCabecalho(); if (S.tab === 'painel') pintarMeta(); }, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) atualizar(); });
}

/* ---------- tela de login / sem acesso ---------- */
function telaConfigFaltando() {
  trocar(root, h('div', { class: 'login' }, h('div', { class: 'card' },
    h('h1', { text: 'Configuração pendente' }),
    h('p', { class: 'hint', text: 'Abra o arquivo config.js do app e preencha SUPABASE_URL e SUPABASE_ANON_KEY com os dados do seu projeto Supabase (Project Settings > API).' }))));
}
function telaLogin(msg) {
  const email = h('input', { type: 'email', autocomplete: 'username', inputmode: 'email', required: true, placeholder: 'voce@exemplo.com' });
  const senha = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const erro = h('div', { class: 'err', style: 'display:none' });
  const btn = h('button', { class: 'b pri', type: 'submit', text: 'Entrar' });
  const form = h('form', { onsubmit: async (ev) => {
    ev.preventDefault(); erro.style.display = 'none'; btn.disabled = true; btn.textContent = 'Entrando…';
    const { error } = await S.sb.auth.signInWithPassword({ email: email.value.trim(), password: senha.value });
    btn.disabled = false; btn.textContent = 'Entrar';
    if (error) { erro.textContent = traduzErro(error.message); erro.style.display = 'block'; return; }
    await depoisDoLogin();
  } }, h('label', { text: 'E-mail' }), email, h('label', { text: 'Senha' }), senha, erro, h('div', { class: 'actions' }, btn));
  trocar(root, h('div', { class: 'login' }, h('div', { class: 'card' },
    h('img', { class: 'logo', src: 'icon.svg', alt: '' }),
    h('h1', { text: 'Monitor de Lotes' }), h('div', { class: 'sub', text: 'Point do Ingresso' }),
    msg ? h('div', { class: 'okmsg', text: msg }) : null, form),
    h('div', { class: 'assin', text: 'by: efcsys' })));
  email.focus();
}
function telaSemAcesso() {
  trocar(root, h('div', { class: 'login' }, h('div', { class: 'card' },
    h('h1', { text: 'Sem acesso' }),
    h('p', { class: 'hint', text: `Você entrou como ${S.user?.email || ''}, mas esse usuário ainda não tem permissão para este app. Peça ao Master para liberar o seu acesso.` }),
    h('div', { class: 'actions' }, h('button', { class: 'b', onclick: sair, text: 'Sair' })))));
}

/* ---------- estrutura principal ---------- */
const ICONES = {
  painel: '<rect x="3" y="12" width="4" height="8" rx="1"/><rect x="10" y="7" width="4" height="13" rx="1"/><rect x="17" y="3" width="4" height="17" rx="1"/>',
  historico: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 8v4l3 2"/>',
  config: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  usuarios: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
  conta: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
};
const icone = (nome) => { const s = svgEl('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }); s.innerHTML = ICONES[nome]; return s; };
const ABAS = () => [['painel', 'Painel'], ['historico', 'Histórico'], ['config', 'Config'], ...(S.papel === 'master' ? [['usuarios', 'Usuários']] : []), ['conta', 'Conta']];

function montarApp() {
  const nav = h('nav', { class: 'nav', id: 'nav' }, ABAS().map(([id, nome]) => h('button', { dataset: undefined, 'data-tab': id, onclick: () => ir(id) }, icone(id), h('span', { text: nome }))));
  trocar(root, 
    h('div', { class: 'wrap' },
      h('header', {}, h('h1', {}, 'Monitor de Lotes', h('small', { text: 'Point do Ingresso' })), h('span', { class: 'pill', id: 'pill' }, h('span', { class: 'dot' }), h('span', { id: 'pilltxt', text: '…' }))),
      nav, h('main', { id: 'view' }), h('div', { class: 'assin', text: 'by: efcsys' })),
    h('div', { class: 'alarme', id: 'alarme' }));
  ir(S.tab);
}
function ir(tab) {
  S.tab = tab;
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('ativo', b.getAttribute('data-tab') === tab));
  window.scrollTo({ top: 0 });
  const v = document.getElementById('view'); trocar(v, h('div', { class: 'meta', text: 'Carregando…' }));
  ({ painel: abrirPainel, historico: abrirHistorico, config: abrirConfig, usuarios: abrirUsuarios, conta: abrirConta }[tab])();
}
function pintarCabecalho() {
  const pill = document.getElementById('pill'); if (!pill) return;
  const on = servidorOnline(); const lendo = on && S.status?.rodando;
  pill.className = 'pill ' + (S.erroRede || !on ? 'off' : lendo ? 'busy' : 'on');
  document.getElementById('pilltxt').textContent = S.erroRede ? 'Sem conexão' : !S.status?.online_em ? 'Servidor nunca conectou' : !on ? `Servidor offline (${ha(S.status.online_em)})` : lendo ? 'Lendo agora' : 'Servidor online';
}

/* ---------- Painel ---------- */
async function abrirPainel() { await atualizar(); }
async function comando(campos) { erroDe(await S.sb.from('lm_config').update({ ...campos, atualizado_em: new Date().toISOString() }).eq('id', 1)); }

function cartao(a, r) {
  const meta = Number(a.meta) || 0; const total = r?.total;
  const atingiu = total != null && meta > 0 && total >= meta;
  const pct = total != null && meta > 0 ? Math.min(100, Math.round((total / meta) * 100)) : 0;
  const c = h('section', { class: 'card' }, h('div', { class: 'nome', text: a.nome }), h('div', { class: 'ev', text: a.evento }));
  const big = h('div', {}, h('span', { class: 'big', text: total != null ? fmtN(total) : '–' }));
  if (meta > 0) big.append(h('span', { class: 'of', text: '/ ' + fmtN(meta) }));
  if (r?.variacao) big.append(h('span', { class: 'delta' + (r.variacao > 0 ? ' up' : ''), text: (r.variacao > 0 ? '+' : '') + r.variacao }));
  c.append(big);
  if (meta > 0) { const bar = h('div', { class: 'bar' + (atingiu ? ' done' : '') }, h('i')); bar.firstChild.style.width = pct + '%'; c.append(bar, h('div', { class: 'hint', text: pct + '% da meta' })); }
  if (atingiu) c.append(h('div', { class: 'badge', text: 'META ATINGIDA' }));
  if (r?.totalGeral != null) {
    const tg = h('div', { class: 'tg' }, h('div', { class: 'hint', text: 'Total geral (com cortesias)' }), h('div', { class: 'tgn', text: fmtN(r.totalGeral) }));
    if ((r.porEvento || []).length > 1) tg.append(h('div', { class: 'hint', text: r.porEvento.map((x) => `${x.nome}: ${fmtN(x.qtd)}`).join(' + ') }));
    if ((r.categorias || []).length) tg.append(h('div', { class: 'hint', text: r.categorias.map((x) => `${x.nome[0] + x.nome.slice(1).toLowerCase()} ${fmtN(x.qtd)}`).join(' · ') }));
    c.append(tg);
  }
  if ((r?.detalhe || []).length > 1) {
    const d = h('div', { class: 'det' });
    r.detalhe.forEach((x) => d.append(h('div', {}, x.lote.replace(/^LOTE EXTRA\s*/i, '') + ': ', h('b', { text: String(x.qtd) }))));
    c.append(d);
  }
  if (r?.erro) c.append(h('div', { class: 'err', text: r.erro }));
  if (!r) c.append(h('div', { class: 'hint', text: 'Aguardando a primeira leitura deste evento…' }));
  return c;
}
function pintarMeta() {
  const m = document.getElementById('meta'); if (!m || !S.status || !S.config) return;
  const st = S.status;
  const linhas1 = [`Última leitura: ${fmtData(st.ultima_em)} (${ha(st.ultima_em)})` + (st.modo ? ` · ${st.modo === 'rapido' ? 'leitura rápida' : 'relatório montado'}${st.ms ? ` (${(st.ms / 1000).toFixed(1).replace('.', ',')} s)` : ''}` : '')];
  linhas1.push(!S.config.ativo ? 'Monitoramento pausado' : st.rodando ? 'Lendo agora…' : st.proxima_em ? `Próxima leitura: ${fmtHora(st.proxima_em)}` : 'Aguardando o servidor');
  if (st.periodo) linhas1.push(`Período do relatório: ${st.periodo}`);
  trocar(m, ...linhas1.map((t) => h('div', { text: t })));
}
function pintarPainel() {
  const v = document.getElementById('view'); if (!v || !S.config) return;
  const st = S.status || {}; const alvos = S.config.alvos || [];
  const res = new Map((st.resultados || []).map((r) => [r.id, r]));
  const nodes = [];
  if (S.erroRede) nodes.push(h('div', { class: 'err', text: S.erroRede }));
  else if (!servidorOnline()) nodes.push(h('div', { class: 'aviso', text: st.online_em ? `O servidor não dá sinal desde ${fmtData(st.online_em)}. Os números abaixo são da última leitura.` : 'O servidor ainda não se conectou. Confira se o container está rodando na Oracle.' }));
  const atingidos = alvos.filter((a) => { const r = res.get(a.id); return r?.total != null && a.meta > 0 && r.total >= a.meta; });
  if (atingidos.length) nodes.push(h('div', { class: 'banner', text: 'Meta atingida: ' + atingidos.map((a) => `${a.nome} (${a.meta})`).join(' · ') }));
  if (st.erro) nodes.push(h('div', { class: 'err', text: `${st.erro}${st.erro_em ? ` (${fmtData(st.erro_em)})` : ''}` }));

  const ctrl = h('section', { class: 'card' }, h('div', { class: 'meta', id: 'meta' }));
  const bLer = h('button', { class: 'b pri', text: 'Ler agora', disabled: st.rodando || !servidorOnline(), onclick: async (e) => { e.target.disabled = true; try { await comando({ pedir_leitura_em: new Date().toISOString() }); } catch (x) { alert(x.message); } setTimeout(atualizar, 1500); } });
  const bAtivo = h('button', { class: 'b ' + (S.config.ativo ? 'stop' : ''), text: S.config.ativo ? 'Pausar' : 'Retomar', onclick: async () => { try { await comando({ ativo: !S.config.ativo }); } catch (x) { alert(x.message); } atualizar(); } });
  const somOn = Alarme.somAtivo();
  const bSom = h('button', { class: 'b', text: somOn ? 'Som: ligado' : 'Som: desligado', onclick: () => { guarda.gravar('lm_som', somOn ? '0' : '1'); if (!somOn) { Alarme.liberar(); Alarme.tocar(1); } pintarPainel(); } });
  ctrl.append(h('div', { class: 'actions' }, bLer, bAtivo), h('div', { class: 'actions' }, bSom, h('button', { class: 'b', text: 'Testar alarme', onclick: () => mostrarAlarme({ id: 'teste', alvo_nome: 'Teste do alarme', total: 200, meta: 200 }) })));
  ctrl.append(h('div', { class: 'hint', text: 'O alarme sonoro toca neste aparelho enquanto o app estiver aberto. Com o app fechado, o aviso chega pelo Telegram.' }));
  if ('Notification' in window && Notification.permission === 'default') ctrl.append(h('div', { class: 'actions' }, h('button', { class: 'b', text: 'Ativar notificações do aparelho', onclick: async () => { await Notification.requestPermission(); pintarPainel(); } })));
  nodes.push(ctrl);
  const cols = h('div', { class: 'cols' }, alvos.map((a) => cartao(a, res.get(a.id))));
  nodes.push(cols);
  if (S.alertas.length) {
    const t = h('table', {}, h('thead', {}, h('tr', {}, h('th', { text: 'Quando' }), h('th', { text: 'Evento' }), h('th', { class: 'n', text: 'Total / meta' }))),
      h('tbody', {}, S.alertas.slice(0, 5).map((a) => h('tr', {}, h('td', { text: fmtData(a.em) }), h('td', { text: a.alvo_nome || a.alvo_id }), h('td', { class: 'n', text: `${fmtN(a.total)} / ${fmtN(a.meta)}` })))));
    nodes.push(h('section', { class: 'card' }, h('h2', { text: 'Metas atingidas' }), h('div', { class: 'tw' }, t)));
  }
  trocar(v, ...nodes);
  pintarMeta();
}

/* ---------- Histórico ---------- */
async function abrirHistorico() {
  try { await carregarConfig(); S.hAlvo = S.hAlvo || S.config.alvos?.[0]?.id || null; await carregarLeituras(); S.erroRede = null; } catch (e) { S.erroRede = traduzErro(e.message); }
  pintarHistorico();
}
function grafico(pontos, meta) {
  const W = 640; const H = 220; const m = { l: 44, r: 12, t: 12, b: 26 };
  const svg = svgEl('svg', { class: 'grafico', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Evolução das vendas do lote' });
  if (pontos.length < 2) { const t = svgEl('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle' }); t.textContent = 'Poucas leituras ainda para desenhar o gráfico'; svg.append(t); return svg; }
  const xs = pontos.map((p) => Date.parse(p.em)); const ys = pontos.map((p) => p.total);
  const x0 = Math.min(...xs); const x1 = Math.max(...xs);
  const y1 = Math.max(...ys, meta || 0) * 1.05 || 1; const y0 = Math.min(...ys, meta || Infinity) * 0.95;
  const X = (x) => m.l + ((x - x0) / Math.max(1, x1 - x0)) * (W - m.l - m.r);
  const Y = (y) => H - m.b - ((y - y0) / Math.max(1, y1 - y0)) * (H - m.t - m.b);
  for (let i = 0; i <= 3; i++) {
    const v = y0 + ((y1 - y0) * i) / 3; const y = Y(v);
    svg.append(svgEl('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, stroke: 'currentColor', 'stroke-opacity': '.12' }));
    const t = svgEl('text', { x: m.l - 6, y: y + 3, 'text-anchor': 'end' }); t.textContent = fmtN(Math.round(v)); svg.append(t);
  }
  if (meta > 0 && meta >= y0 && meta <= y1) {
    svg.append(svgEl('line', { x1: m.l, x2: W - m.r, y1: Y(meta), y2: Y(meta), stroke: '#10b981', 'stroke-dasharray': '5 4' }));
    const t = svgEl('text', { x: W - m.r, y: Y(meta) - 4, 'text-anchor': 'end' }); t.textContent = 'meta ' + fmtN(meta); svg.append(t);
  }
  svg.append(svgEl('polyline', { points: pontos.map((p) => `${X(Date.parse(p.em)).toFixed(1)},${Y(p.total).toFixed(1)}`).join(' '), fill: 'none', stroke: '#f97316', 'stroke-width': '2.5', 'stroke-linejoin': 'round' }));
  const ult = pontos[pontos.length - 1]; svg.append(svgEl('circle', { cx: X(Date.parse(ult.em)), cy: Y(ult.total), r: 4, fill: '#f97316' }));
  [[x0, 'start'], [x1, 'end']].forEach(([x, anchor]) => { const t = svgEl('text', { x: X(x), y: H - 8, 'text-anchor': anchor }); t.textContent = new Date(x).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); svg.append(t); });
  return svg;
}
function pintarHistorico() {
  const v = document.getElementById('view'); if (!v) return;
  const alvos = S.config?.alvos || [];
  const sel = h('select', { onchange: async (e) => { S.hAlvo = e.target.value; try { await carregarLeituras(); } catch (x) { S.erroRede = traduzErro(x.message); } pintarHistorico(); } }, alvos.map((a) => h('option', { value: a.id, text: a.nome })));
  sel.value = S.hAlvo || '';
  const alvo = alvos.find((a) => a.id === S.hAlvo);
  const asc = [...S.leituras].reverse();
  const tabela = h('table', {}, h('thead', {}, h('tr', {}, h('th', { text: 'Quando' }), h('th', { class: 'n', text: 'Lotes' }), h('th', { class: 'n', text: 'Var.' }), h('th', { class: 'n', text: 'Total geral' }))),
    h('tbody', {}, S.leituras.map((x) => h('tr', {}, h('td', { text: fmtData(x.em) }), h('td', { class: 'n', text: fmtN(x.total) }), h('td', { class: 'n', text: (x.variacao > 0 ? '+' : '') + x.variacao }), h('td', { class: 'n', text: fmtN(x.total_geral) })))));
  trocar(v, 
    S.erroRede ? h('div', { class: 'err', text: S.erroRede }) : null,
    h('section', { class: 'card' }, h('h2', { text: 'Evento' }), sel, h('div', { style: 'margin-top:14px' }, grafico(asc, alvo?.meta || 0))),
    h('section', { class: 'card' }, h('h2', { text: `Últimas leituras (${S.leituras.length})` }), S.leituras.length ? h('div', { class: 'tw' }, tabela) : h('div', { class: 'hint', text: 'Nenhuma leitura registrada ainda.' })));
}

/* ---------- Configuração ---------- */
function editorAlvo(a) {
  const f = {
    nome: h('input', { value: a.nome || '', placeholder: 'Ex.: Camarote Aju Sexta' }),
    evento: h('input', { value: a.evento || '', placeholder: '[13/11/2026] CAMAROTE AJU SEXTA (13/11)' }),
    lotes: h('textarea', { value: (a.lotes || []).join('\n'), placeholder: 'Um lote por linha (as quantidades são somadas)' }),
    tge: h('textarea', { value: (a.totalGeralEventos || []).join('\n'), placeholder: 'BLOCO VUMBORA SABADO (14/11)\nBLOCO VUMBORA PACOTE' }),
    meta: h('input', { type: 'number', min: '0', inputmode: 'numeric', value: a.meta ?? 0 }),
  };
  const box = h('div', { class: 'alvo', 'data-id': a.id || '' },
    h('div', { class: 'top' }, h('b', { text: 'Evento' }), h('button', { class: 'b sm stop', type: 'button', text: 'Remover', onclick: () => box.remove() })),
    h('label', { text: 'Nome' }), f.nome,
    h('label', { text: 'Nome do evento no seletor do admin' }), f.evento,
    h('label', { text: 'Lotes monitorados (um por linha, somados)' }), f.lotes,
    h('label', { text: 'Eventos somados no Total Geral (um por linha; vazio = só o evento acima)' }), f.tge,
    h('label', { text: 'Meta (soma dos lotes que dispara o alarme)' }), f.meta);
  box.lerForm = () => ({ id: box.getAttribute('data-id') || '', nome: f.nome.value.trim(), evento: f.evento.value.trim(), lotes: linhas(f.lotes.value), totalGeralEventos: linhas(f.tge.value), meta: Math.max(0, Math.floor(Number(f.meta.value) || 0)) });
  return box;
}
async function abrirConfig() {
  try { await carregarConfig(); await carregarStatus(); S.erroRede = null; } catch (e) { S.erroRede = traduzErro(e.message); }
  const v = document.getElementById('view'); if (!v) return;
  if (!S.config) { trocar(v, h('div', { class: 'err', text: S.erroRede || 'Configuração não encontrada. Rode o SQL de instalação no Supabase.' })); return; }
  const c = S.config;
  const intervalo = h('input', { type: 'number', min: '1', max: '60', inputmode: 'numeric', value: c.intervalo_min });
  const tg = h('input', { type: 'checkbox', id: 'tgativo', checked: c.telegram_ativo });
  const lista = h('div', {}, (c.alvos || []).map(editorAlvo));
  const msg = h('div', { style: 'display:none' });
  const mostra = (t, ok) => { msg.className = ok ? 'okmsg' : 'err'; msg.textContent = t; msg.style.display = 'block'; };
  const salvar = async (ev) => {
    ev.target.disabled = true;
    try {
      const itv = Math.floor(Number(intervalo.value));
      if (!(itv >= 1 && itv <= 60)) throw new Error('O intervalo deve ficar entre 1 e 60 minutos.');
      const usados = new Set(); const alvos = [];
      for (const box of lista.querySelectorAll('.alvo')) {
        const a = box.lerForm();
        if (!a.nome || !a.evento || !a.lotes.length) throw new Error('Cada evento precisa de nome, nome no seletor do admin e pelo menos um lote.');
        let id = a.id || slug(a.nome) || 'alvo'; while (usados.has(id)) id += '-2'; usados.add(id); a.id = id;
        alvos.push(a);
      }
      if (!alvos.length) throw new Error('Mantenha pelo menos um evento.');
      await comando({ intervalo_min: itv, telegram_ativo: tg.checked, alvos });
      mostra('Salvo. O servidor aplica na próxima leitura.', true);
      await carregarConfig();
    } catch (e) { mostra(traduzErro(e.message), false); }
    ev.target.disabled = false;
  };
  const testarTg = async (ev) => {
    ev.target.disabled = true;
    try {
      if (!S.status?.telegram_configurado) throw new Error('O servidor ainda não tem TELEGRAM_TOKEN e TELEGRAM_CHAT_ID no .env.');
      await comando({ pedir_teste_em: new Date().toISOString() });
      mostra('Pedido enviado. Em até 15 segundos chega uma mensagem de teste no Telegram.', true);
    } catch (e) { mostra(traduzErro(e.message), false); }
    ev.target.disabled = false;
  };
  trocar(v, 
    S.erroRede ? h('div', { class: 'err', text: S.erroRede }) : null,
    h('section', { class: 'card' }, h('h2', { text: 'Leitura e avisos' }),
      h('label', { for: 'itv', text: 'Intervalo entre leituras (minutos, de 1 a 60)' }), (intervalo.id = 'itv', intervalo),
      h('div', { class: 'chk' }, tg, h('label', { for: 'tgativo', text: 'Avisar no Telegram (metas e erros)' })),
      h('div', { class: 'hint', text: `Telegram no servidor: ${S.status?.telegram_configurado ? 'configurado' : 'não configurado'}. O login e a senha do admin do Point ficam só no servidor, nunca neste app.` }),
      h('div', { class: 'actions' }, h('button', { class: 'b', type: 'button', text: 'Testar Telegram', onclick: testarTg }))),
    h('section', { class: 'card' }, h('h2', { text: 'Eventos e lotes monitorados' }), lista,
      h('div', { class: 'actions' }, h('button', { class: 'b', type: 'button', text: '+ Adicionar evento', onclick: () => lista.append(editorAlvo({ nome: '', evento: '', lotes: [], meta: 0 })) })),
      h('div', { class: 'hint', text: 'Ao mudar os eventos, o servidor monta o relatório de novo sozinho na próxima leitura.' })),
    h('div', { class: 'actions' }, h('button', { class: 'b pri', type: 'button', text: 'Salvar tudo', onclick: salvar })), msg);
}

/* ---------- Usuários (Master) ---------- */
async function fnUsuarios(body) {
  const { data, error } = await S.sb.functions.invoke('lm-admin-users', { body });
  if (error) { let m = error.message; try { const j = await error.context.json(); if (j?.erro) m = j.erro; } catch {} throw new Error(m); }
  if (data?.erro) throw new Error(data.erro);
  return data;
}
async function abrirUsuarios() {
  const v = document.getElementById('view');
  try { S.users = (await fnUsuarios({ acao: 'listar' })).usuarios; } catch (e) { trocar(v, h('div', { class: 'err', text: traduzErro(e.message) })); return; }
  const msg = h('div', { style: 'display:none' });
  const mostra = (t, ok) => { msg.className = ok ? 'okmsg' : 'err'; msg.textContent = t; msg.style.display = 'block'; };
  const email = h('input', { type: 'email', autocomplete: 'off', placeholder: 'novo@exemplo.com' });
  const nome = h('input', { autocomplete: 'off', placeholder: 'Nome (opcional)' });
  const senha = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Mínimo 8 caracteres (só para usuário novo)' });
  const papel = h('select', {}, h('option', { value: 'admin', text: 'Administrador (vê e configura)' }), h('option', { value: 'master', text: 'Master (também gerencia usuários)' }));
  const tabela = h('table', {}, h('thead', {}, h('tr', {}, h('th', { text: 'Usuário' }), h('th', { text: 'Papel' }), h('th', {}))),
    h('tbody', {}, S.users.map((u) => h('tr', {}, h('td', { text: (u.nome ? u.nome + ' · ' : '') + u.email }), h('td', { text: u.papel }),
      h('td', { class: 'n' }, u.eu ? h('span', { class: 'hint', text: 'você' }) : h('button', { class: 'b sm stop', text: 'Remover', onclick: async () => {
        if (!confirm(`Remover o acesso de ${u.email} a este app?`)) return;
        try { await fnUsuarios({ acao: 'remover', user_id: u.user_id }); abrirUsuarios(); } catch (e) { mostra(traduzErro(e.message), false); }
      } }))))));
  trocar(v, 
    h('section', { class: 'card' }, h('h2', { text: 'Quem tem acesso' }), h('div', { class: 'tw' }, tabela), h('div', { class: 'hint', text: 'Remover tira só o acesso a este app; o usuário continua existindo no Supabase (o PointBot usa o mesmo projeto).' })),
    h('section', { class: 'card' }, h('h2', { text: 'Liberar acesso' }),
      h('label', { text: 'E-mail' }), email, h('label', { text: 'Nome' }), nome, h('label', { text: 'Senha inicial' }), senha, h('label', { text: 'Papel' }), papel,
      h('div', { class: 'hint', text: 'Se o e-mail já existir no Supabase, só o acesso é liberado e a senha atual é mantida.' }),
      h('div', { class: 'actions' }, h('button', { class: 'b pri', text: 'Liberar acesso', onclick: async (e) => {
        e.target.disabled = true;
        try { const r = await fnUsuarios({ acao: 'criar', email: email.value, senha: senha.value, nome: nome.value, papel: papel.value }); await abrirUsuarios(); const m2 = document.getElementById('view'); m2.prepend(h('div', { class: 'okmsg', text: r.jaExistia ? 'Acesso liberado (usuário já existia).' : 'Usuário criado e liberado.' })); }
        catch (x) { mostra(traduzErro(x.message), false); e.target.disabled = false; }
      } })), msg));
}

/* ---------- Conta ---------- */
function abrirConta() {
  const v = document.getElementById('view');
  const nova = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Mínimo 8 caracteres' });
  const msg = h('div', { style: 'display:none' });
  const mostra = (t, ok) => { msg.className = ok ? 'okmsg' : 'err'; msg.textContent = t; msg.style.display = 'block'; };
  trocar(v, 
    h('section', { class: 'card' }, h('h2', { text: 'Minha conta' }), h('div', { class: 'meta', text: S.user?.email || '' }), h('div', { class: 'meta', text: 'Papel: ' + (S.papel === 'master' ? 'Master' : 'Administrador') }),
      h('label', { text: 'Nova senha' }), nova,
      h('div', { class: 'actions' }, h('button', { class: 'b', text: 'Trocar senha', onclick: async () => {
        if (nova.value.length < 8) return mostra('A senha precisa ter pelo menos 8 caracteres.', false);
        const { error } = await S.sb.auth.updateUser({ password: nova.value });
        if (error) return mostra(traduzErro(error.message), false);
        nova.value = ''; mostra('Senha alterada.', true);
      } }), h('button', { class: 'b stop', text: 'Sair', onclick: sair })), msg));
}
async function sair() {
  Alarme.parar(); clearInterval(S.timer); clearInterval(S.tick);
  try { if (S.canal) await S.sb.removeChannel(S.canal); } catch {}
  S.canal = null; S.maxAlertaId = null; S.papel = null; S.user = null; S.config = null; S.status = null;
  await S.sb.auth.signOut();
  telaLogin();
}

/* ---------- início ---------- */
async function depoisDoLogin() {
  const { data: { session } } = await S.sb.auth.getSession();
  if (!session) return telaLogin();
  S.user = session.user;
  const r = await S.sb.rpc('lm_papel');
  S.papel = r.error ? null : r.data;
  if (!S.papel) return telaSemAcesso();
  S.tab = 'painel'; montarApp(); iniciarTempoReal();
}
async function iniciar() {
  if (!CFG.SUPABASE_URL || /SEU-PROJETO/.test(CFG.SUPABASE_URL) || !CFG.SUPABASE_ANON_KEY || /COLE_AQUI/.test(CFG.SUPABASE_ANON_KEY) || !window.supabase) return telaConfigFaltando();
  S.sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  S.sb.auth.onAuthStateChange((evento) => { if (evento === 'SIGNED_OUT' && S.user) { S.user = null; telaLogin('Sessão encerrada. Entre novamente.'); } });
  await depoisDoLogin();
}
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
iniciar();
})();
