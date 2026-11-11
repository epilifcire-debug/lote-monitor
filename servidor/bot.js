// Robô do admin. Projetado para servidor pequeno (1 GB): o navegador só abre para entrar e montar o relatório;
// depois ele é FECHADO e as leituras seguintes repetem a mesma requisição do relatório por HTTP (leve e rápido).
const fs = require('fs');
const path = require('path');
const { log, sleep, norm, nomesDoAlvo, hojeBR } = require('./lib/util');
const { parseRelatorio, validarRelatorio, montarResultados } = require('./lib/relatorio');

let C = {};

const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA, { recursive: true });
const SESSAO = path.join(DATA, 'sessao.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const contarSelecionados = (page) => page.evaluate(() => { const m = document.body.innerText.match(/(\d+)\s*selecionados?/i); return m ? Number(m[1]) : null; });


async function dump(page, nome) {
  try {
    await page.screenshot({ path: path.join(DATA, `${nome}.png`), fullPage: true });
    fs.writeFileSync(path.join(DATA, `${nome}.html`), await page.content());
  } catch {}
}


async function clicarPorTexto(page, texto, { escopo = 'a,button,li,span,label,div[role=button]', exato = false } = {}) {
  const alvo = norm(texto);
  const ok = await page.evaluate(
    (alvo, escopo, exato) => {
      const n = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
      const els = [...document.querySelectorAll(escopo)].filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      // prefere o elemento mais "interno" (menor texto) que case
      const match = els
        .filter((e) => (exato ? n(e.textContent) === alvo : n(e.textContent).includes(alvo)))
        .sort((a, b) => n(a.textContent).length - n(b.textContent).length)[0];
      if (!match) return false;
      match.scrollIntoView({ block: 'center' });
      match.click();
      return true;
    },
    alvo, escopo, exato
  );
  return ok;
}


async function login(page) {
  log('Login...');
  await page.goto(C.url, { waitUntil: 'networkidle2', timeout: 60000 });
  // já logado?
  if (await page.$('nav, .navbar, #sidebar, .sidebar')) {
    const txt = norm(await page.evaluate(() => document.body.innerText));
    if (txt.includes('resumo') && txt.includes('vendas')) return;
  }
  const userSel = 'input[type=text], input[name*=user i], input[name*=login i]';
  const passSel = 'input[type=password]';
  await page.waitForSelector(passSel, { timeout: 20000 });
  await page.click(userSel, { clickCount: 3 });
  await page.type(userSel, C.user, { delay: 30 });
  await page.type(passSel, C.pass, { delay: 30 });
  const sel = await page.$('select');
  if (sel) await page.select('select', C.year).catch(() => {});
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {}),
    clicarPorTexto(page, 'entrar', { escopo: 'button,input[type=submit],a' }).then(async (ok) => {
      if (!ok) await page.keyboard.press('Enter');
    }),
  ]);
  const ainda = await page.$(passSel);
  if (ainda) { await dump(page, 'erro-login'); throw new Error('Login falhou (veja data/erro-login.png)'); }
  log('Login OK');
}


async function marcarCortesia(page, alvo) {
  const achar = () => page.evaluate(() => {
    const n = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const vis = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); const st = getComputedStyle(e); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'; };
    document.querySelectorAll('[data-bot-cortesia],[data-bot-click]').forEach((e) => { e.removeAttribute('data-bot-cortesia'); e.removeAttribute('data-bot-click'); });
    const achados = [...document.querySelectorAll('input[type=checkbox]')].map((i) => {
      const lab = i.id ? document.querySelector(`label[for="${i.id}"]`) : null;
      const avo = i.parentElement?.parentElement;
      const txt = n([lab?.textContent, i.closest('label')?.textContent, i.parentElement?.textContent,
        avo && avo.textContent.length < 80 ? avo.textContent : '', i.name, i.id,
        i.getAttribute('title'), i.getAttribute('aria-label'), i.getAttribute('data-label')].join(' '));
      return { i, txt };
    }).filter((x) => x.txt.includes('cortesia')).sort((a, b) => a.txt.length - b.txt.length);
    if (!achados.length) return null;
    const { i, txt } = achados[0];
    i.setAttribute('data-bot-cortesia', '1');
    const lab = i.id ? document.querySelector(`label[for="${i.id}"]`) : null;
    const pequeno = (e) => { const r = e.getBoundingClientRect(); return r.width <= 260 && r.height <= 90; };
    const alvoClique = [i, lab, i.closest('label'), i.parentElement, i.parentElement?.parentElement, i.nextElementSibling]
      .find((e) => e && vis(e) && pequeno(e));
    if (alvoClique) alvoClique.setAttribute('data-bot-click', '1');
    return { marcado: i.checked, texto: txt.slice(0, 80), visivel: !!alvoClique };
  });
  const textoPagina = () => page.evaluate(() => {
    const t = document.body.innerText; let h = 5381;
    for (let k = 0; k < t.length; k++) h = ((h << 5) + h + t.charCodeAt(k)) | 0;
    return String(h);
  });

  let info = await achar();
  if (!info) {
    await dump(page, 'diag-cortesia');
    throw new Error(`Não encontrei a chave "Sem/Com Cortesia" na tela Eventos Detalhados (${alvo.nome}). Veja data/diag-cortesia.png e data/diag-cortesia.html.`);
  }
  if (info.marcado) { log(`Cortesia já marcada (${info.texto})`); return; }

  log(`Marcando Cortesia (${info.texto})`);
  const antes = await textoPagina();
  const clicar = async () => {
    const h = await page.$('[data-bot-click="1"]');
    if (h) { await h.click().catch(() => {}); return; }
    await page.evaluate(() => document.querySelector('[data-bot-cortesia="1"]')?.click());
  };
  const esperarAtualizar = async () => {
    await page.waitForNetworkIdle({ idleTime: 800, timeout: 8000 }).catch(() => {});
    const fim = Date.now() + 6000;
    while (Date.now() < fim && (await textoPagina().catch(() => antes)) === antes) await sleep(500);
    await sleep(800);
  };

  await clicar();
  await esperarAtualizar();
  info = await achar();
  if (info && !info.marcado) { // a chave pode não ter reagido ao clique: força pelo próprio input
    await page.evaluate(() => {
      const i = document.querySelector('[data-bot-cortesia="1"]');
      if (!i) return;
      i.click();
      if (!i.checked) { i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await esperarAtualizar();
    info = await achar();
  }
  if (!info || !info.marcado) {
    await dump(page, 'diag-cortesia');
    throw new Error(`Não consegui ligar a chave "Cortesia" em ${alvo.nome}. Veja data/diag-cortesia.png e .html`);
  }
  log('Cortesia marcada ✓');
}


async function diagLista(page) {
  return page.evaluate(() => {
    const n = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const cbs = [...document.querySelectorAll('input[type=checkbox]')];
    const amostra = cbs.slice(0, 40).map((i) => n((i.closest('label') || i.parentElement?.parentElement || i.parentElement)?.textContent).slice(0, 60));
    return { checkboxes: cbs.length, amostra, paginacao: !!document.querySelector('.pagination'), url: location.pathname };
  }).catch(() => ({}));
}


async function selecionarEventoNaLista(page, curto) {
  const tentar = () => page.evaluate((alvo) => {
    const n = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const vis = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    document.querySelectorAll('[data-bot-ev],[data-bot-evclick]').forEach((e) => { e.removeAttribute('data-bot-ev'); e.removeAttribute('data-bot-evclick'); });
    const cards = [];
    for (const i of document.querySelectorAll('input[type=checkbox]')) {
      let c = i.parentElement, cont = null;
      for (let k = 0; k < 5 && c; k++, c = c.parentElement) {
        const t = c.textContent || '';
        if (t.length > 4 && t.length < 160 && /\d{2}\/\d{2}\/\d{4}/.test(t)) { cont = c; break; }
      }
      if (cont) cards.push({ i, cont, txt: n(cont.textContent) });
    }
    const m = cards.filter((x) => x.txt.includes(alvo)).sort((a, b) => (b.txt.startsWith(alvo) - a.txt.startsWith(alvo)) || (a.txt.length - b.txt.length))[0];
    if (!m) return null;
    m.i.setAttribute('data-bot-ev', '1');
    const lab = m.i.id ? document.querySelector(`label[for="${m.i.id}"]`) : null;
    const clique = [m.i, lab, m.i.closest('label'), m.cont].find((e) => e && vis(e));
    if (clique) clique.setAttribute('data-bot-evclick', '1');
    return { marcado: m.i.checked, texto: m.txt.slice(0, 60) };
  }, norm(curto));

  let info = await tentar();
  if (!info) { // evento pode estar em outra página da lista
    const paginas = await page.evaluate(() => [...document.querySelectorAll('.pagination a, .pagination li')].map((e) => e.textContent.trim()).filter((t) => /^\d+$/.test(t)));
    for (const p of [...new Set(paginas)]) {
      await clicarPorTexto(page, p, { escopo: '.pagination a', exato: true });
      await sleep(800);
      info = await tentar();
      if (info) break;
    }
  }
  if (!info) {
    // plano B: acha o cartão pelo TEXTO do título e clica com o mouse onde fica a caixinha (lado esquerdo)
    const antes = await contarSelecionados(page);
    const pos = await page.evaluate((alvo) => {
      const n = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const tit = [...document.querySelectorAll('div,label,span,strong,b,h3,h4,h5,h6,p,li,a')].filter(vis)
        .filter((e) => { const t = n(e.textContent); return t.startsWith(alvo) && t.length < 160; })
        .sort((a, b) => a.textContent.length - b.textContent.length)[0];
      if (!tit) return null;
      let card = tit;
      for (let k = 0; k < 4 && card.parentElement; k++) {
        const p = card.parentElement; const t = p.textContent || '';
        if (t.length < 160 && /\d{2}\/\d{2}\/\d{4}/.test(t)) card = p; else break;
      }
      card.scrollIntoView({ block: 'center' });
      const r = card.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    }, norm(curto));
    if (!pos) return null;
    await sleep(300);
    const tentativas = [[pos.x + 22, pos.y + pos.h / 2], [pos.x + pos.w / 2, pos.y + pos.h / 2]];
    for (const [x, y] of tentativas) {
      // a rolagem pode ter mudado a posição: remede antes de clicar
      await page.mouse.click(x, y).catch(() => {});
      await sleep(600);
      const depois = await contarSelecionados(page);
      if (antes != null && depois != null && depois > antes) return { marcado: false, texto: '(clique no cartão)' };
    }
    return null;
  }
  if (!info.marcado) {
    const h = await page.$('[data-bot-evclick="1"]');
    if (h) await h.click().catch(() => {}); else await page.evaluate(() => document.querySelector('[data-bot-ev="1"]')?.click());
    await sleep(500);
  }
  let ok = await page.evaluate(() => !!document.querySelector('[data-bot-ev="1"]')?.checked);
  if (!ok) { await page.evaluate(() => document.querySelector('[data-bot-ev="1"]')?.click()); await sleep(500); ok = await page.evaluate(() => !!document.querySelector('[data-bot-ev="1"]')?.checked); }
  return ok ? info : null;
}


const URL_SELECAO = '/Reports/VendasEventosDetalhados/';

async function prepararRelatorio(page, nomes) {
  log(`Montando o relatório (com cortesias): ${nomes.join(' + ')}`);
  await page.goto(C.url + URL_SELECAO, { waitUntil: 'networkidle2', timeout: 45000 });
  if (await page.$('input[type=password]')) { // sessão expirou
    log('Sessão expirada, entrando de novo...');
    await login(page);
    await page.goto(C.url + URL_SELECAO, { waitUntil: 'networkidle2', timeout: 45000 });
  }

  // 1) chave "Com Cortesia" ligada (antes de escolher os eventos, pois a chave pode recarregar a tela)
  await marcarCortesia(page, { nome: 'Eventos Detalhados' });

  // 2) espera a lista, limpa a seleção e marca TODOS os eventos
  await page.waitForFunction(() => document.querySelectorAll('input[type=checkbox]').length > 2, { timeout: 15000 }).catch(() => {});
  await sleep(800);
  await clicarPorTexto(page, 'limpar', { escopo: 'button,a' });
  await sleep(600);
  const buscar = async (txt) => {
    const b = await page.$('input[placeholder*="buscar evento" i]');
    if (!b) return;
    await b.click({ clickCount: 3 }).catch(() => {});
    await page.keyboard.press('Backspace');
    if (txt) await b.type(txt, { delay: 25 });
    await sleep(900);
  };
  const marcarTodos = async (comBusca, lista) => {
    const faltou = [];
    for (const nome of lista) {
      await buscar(comBusca ? nome : '');
      if (!(await selecionarEventoNaLista(page, nome))) faltou.push(nome);
    }
    return faltou;
  };
  let faltou = await marcarTodos(true, nomes);
  if (faltou.length) faltou = await marcarTodos(false, faltou); // plano B só para os que faltaram, sem busca
  const qtdSel = await contarSelecionados(page);
  log(`Eventos selecionados na tela: ${qtdSel ?? '?'} de ${nomes.length}`);
  if (faltou.length || (qtdSel != null && qtdSel !== nomes.length)) {
    await dump(page, 'diag-relatorio');
    const d = await diagLista(page);
    if (faltou.length) throw new Error(`Evento(s) não encontrado(s) na lista do admin: ${faltou.join(' | ')}. Confira o nome exato na aba Config. Nomes na página: ${(d.amostra || []).join(' | ')}`);
    throw new Error(`Selecionados na tela: ${qtdSel} de ${nomes.length}; confira se há eventos repetidos na Config. Nomes na página: ${(d.amostra || []).join(' | ')}`);
  }
  await buscar(''); // deixa a lista completa antes de gerar

  // 3) gera o relatório
  const nav = page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 40000 }).catch(() => null);
  const clicou = await clicarPorTexto(page, 'gerar relatorio', { escopo: 'button,a,input[type=submit],input[type=button]' });
  if (!clicou) throw new Error('Botão "Gerar Relatório" não encontrado');
  await nav;
  const fim = Date.now() + 30000;
  while (Date.now() < fim) {
    const pronto = await page.evaluate(() => /total\s+geral/i.test(document.body.innerText)).catch(() => false);
    if (pronto) break;
    await sleep(800);
  }
}



function acharNavegador() {
  const cands = [
    process.env.PUPPETEER_EXECUTABLE_PATH, process.env.CHROME_PATH,
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  const exe = cands.find((p) => p && fs.existsSync(p));
  if (!exe) throw new Error('Navegador não encontrado (defina PUPPETEER_EXECUTABLE_PATH)');
  return exe;
}

// ---------- sessão salva (cookies + a requisição que gera o relatório) ----------
let sess = null; // { chave, cookie, req: { url, method, postData, contentType, referer }, desde }
function carregarSessao() {
  if (sess) return sess;
  try { sess = JSON.parse(fs.readFileSync(SESSAO, 'utf8')); } catch { sess = null; }
  return sess;
}
function salvarSessao(s) {
  sess = s;
  try {
    if (s) fs.writeFileSync(SESSAO, JSON.stringify(s), { mode: 0o600 });
    else fs.rmSync(SESSAO, { force: true });
  } catch (e) { log('Aviso: não consegui gravar a sessão:', e.message); }
}

// Releitura rápida: repete a requisição do relatório com os cookies salvos. Não usa navegador.
async function lerRapido(s) {
  const headers = { Cookie: s.cookie, 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', Referer: s.req.referer || C.url + URL_SELECAO };
  const init = { method: s.req.method || 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(45000) };
  if (init.method !== 'GET' && s.req.postData != null) {
    init.body = s.req.postData;
    headers['Content-Type'] = s.req.contentType || 'application/x-www-form-urlencoded';
  }
  const r = await fetch(s.req.url, init);
  if (r.status >= 300 && r.status < 400) throw new Error(`o admin redirecionou (${r.status}) — sessão expirada`);
  if (!r.ok) throw new Error(`o admin respondeu ${r.status}`);
  const rel = validarRelatorio(parseRelatorio(await r.text()));
  // o relatório é gerado para um período fixo: se ele não termina hoje, as vendas de hoje ficariam de fora
  if (rel.periodoFim && rel.periodoFim !== hojeBR()) throw new Error(`o período do relatório termina em ${rel.periodoFim}, não hoje`);
  return rel;
}

// Caminho completo: abre o navegador, entra, monta o relatório, guarda a sessão e FECHA o navegador.
async function montarComNavegador(nomes, chave) {
  const puppeteer = require('puppeteer-core');
  const exe = acharNavegador();
  log('Abrindo o navegador:', exe);
  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: C.headless === false ? false : 'new',
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
      '--disable-extensions', '--disable-background-networking', '--disable-sync', '--disable-default-apps',
      '--mute-audio', '--no-first-run', '--no-zygote', '--renderer-process-limit=1',
      '--disable-features=Translate,BackForwardCache,MediaRouter,OptimizationHints',
      '--js-flags=--max-old-space-size=160',
    ],
    defaultViewport: { width: 1366, height: 768 },
  });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);
    await page.setUserAgent(UA);

    // economiza memória/rede (imagens, fontes e mídia não fazem falta) e captura a requisição do relatório
    let req = null;
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      try {
        if (['image', 'media', 'font'].includes(r.resourceType())) return r.abort();
        if (r.isNavigationRequest() && r.frame() === page.mainFrame() && /GerarRelatorio/i.test(r.url())) {
          const h = r.headers();
          req = { url: r.url(), method: r.method(), postData: r.postData() ?? null, contentType: h['content-type'] || null, referer: h.referer || null };
        }
        r.continue();
      } catch {}
    });

    await login(page);
    await prepararRelatorio(page, nomes);
    const rel = validarRelatorio(parseRelatorio(await page.content()));

    if (rel.periodoFim && rel.periodoFim !== hojeBR()) log(`Aviso: o período do relatório termina em ${rel.periodoFim} (hoje é ${hojeBR()})`);
    let rapido = false;
    if (req) {
      const cookies = await page.cookies(C.url, req.url);
      const nova = { chave, dia: hojeBR(), cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; '), req };
      try { // confere já se a releitura sem navegador devolve o mesmo relatório
        const r2 = await lerRapido(nova);
        if (r2.eventos.length !== rel.eventos.length) throw new Error('a releitura trouxe outro conjunto de eventos');
        rapido = true;
      } catch (e) { log(`Aviso: a leitura rápida não está disponível (${e.message}); as leituras seguirão pelo navegador`); }
      salvarSessao({ ...nova, semRapido: !rapido });
    } else {
      log('Aviso: não identifiquei a requisição do relatório; as leituras seguirão pelo navegador');
      salvarSessao({ chave, dia: hojeBR(), semRapido: true });
    }
    return { rel, rapido };
  } finally {
    await browser.close().catch(() => {});
    log('Navegador fechado');
  }
}

async function ciclo() {
  const t0 = Date.now();
  const nomes = [...new Set(C.alvos.flatMap(nomesDoAlvo))];
  if (!nomes.length) throw new Error('Nenhum evento configurado');
  const chave = JSON.stringify(nomes);

  const s = carregarSessao();
  if (s && s.chave === chave && s.dia === hojeBR() && !s.semRapido && s.req && s.cookie) {
    try {
      const rel = await lerRapido(s);
      const resultados = montarResultados(C.alvos, rel, true);
      log(`Leitura rápida em ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return { resultados, modo: 'rapido', ms: Date.now() - t0, periodo: rel.periodoFim ? `${rel.periodoInicio} à ${rel.periodoFim}` : null };
    } catch (e) {
      log(`Leitura rápida não funcionou (${e.message}); abrindo o navegador`);
      salvarSessao(null);
    }
  }
  const { rel, rapido } = await montarComNavegador(nomes, chave);
  const resultados = montarResultados(C.alvos, rel, false);
  log(`Relatório montado em ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { resultados, modo: rapido ? 'montado' : 'navegador', ms: Date.now() - t0, periodo: rel.periodoFim ? `${rel.periodoInicio} à ${rel.periodoFim}` : null };
}

let ocupado = false;
async function executar(cfg) {
  if (ocupado) throw new Error('Já existe uma leitura em andamento');
  ocupado = true;
  C = cfg;
  try { return await ciclo(); } finally { ocupado = false; }
}
function esquecerSessao() { salvarSessao(null); }
module.exports = { executar, esquecerSessao, DATA };
