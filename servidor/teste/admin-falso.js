// Admin de mentira, montado a partir dos prints das telas reais, só para testar o robô de ponta a ponta.
const http = require('http');

const EVENTOS = [
  'TAJJA - EVENTO TESTE 1 PDI 1', 'BLOCO VUMBORA PACOTE', 'COMBO BL.COMAMOR+ENSAIO(25/07)', 'COMBO BLOCO TORCIDA+CAM.AJUDOM',
  'COMBO BLOCO TOMATE+CAM.AJU DOM', 'COMBO BL.GIGANTE+ENSAIO(25/07)', 'BLOCO COM AMOR IVETE SANGALO', 'BLOCO VEM COM O GIGANTE LEO',
  'BLOCO VUMBORA DOMINGO (15/11)', 'CAMAROTE AJU PACOTE 2026', 'CAMAROTE AJU DOMINGO (15/11)', 'BLOCO DA TORCIDA XANDY HARMONI',
  'BLOCO EU NAO VOU EMBORA TOMATE', 'BLOCO VUMBORA SABADO (14/11)', 'COMBO BL.TORCIDA+ENSAIO(25/07)', 'COMBO BL.TOMATE+ENSIAO(25/07)',
  'CAMAROTE AJU SABADO (14/11)', 'CAMAROTE AJU SEXTA (13/11)',
];
const POR_PAGINA = 12;

function criar({ semEspacos = false, sessaoCurta = false } = {}) {
  const st = { logins: 0, relatorios: 0, vendasExtra: 312, sessoes: new Set(), ultimoPost: null, hoje: null };
  const hoje = () => st.hoje || new Intl.DateTimeFormat('pt-BR', { timeZone: process.env.TZ || 'America/Maceio', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
  const topo = `<nav class="navbar"><a>Point do Ingresso Admin</a><div class="dropdown"><a class="dropdown-toggle" href="#">EVENTO: [01/01/2030] TAJJA - EVENTO TESTE 1 PDI 1</a></div></nav>
    <ul class="sidebar"><li><a href="/">Resumo</a></li><li><a href="#">Vendas</a></li></ul>`;
  const logado = (req) => { const m = /sid=(\w+)/.exec(req.headers.cookie || ''); return m && st.sessoes.has(m[1]); };
  const corpo = (req) => new Promise((ok) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => ok(b)); });
  const html = (res, h, code = 200, extra = {}) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', ...extra }); res.end(h); };

  function relatorio(ids, cortesia) {
    const j = semEspacos ? '' : '\n';
    const tab = (linhas, sub, q) => `<table><thead><tr><th>Lote</th><th>Vl Unit (R$)</th><th>Qtd</th><th>Total (R$)</th></tr></thead><tbody>${j}`
      + linhas.map((l) => `<tr><td>${l[0]}</td><td>${l[1]}</td><td>${l[2]}</td><td>${l[3]}</td></tr>`).join(j)
      + `<tr><td colspan="2"><b>Subtotal (${sub} ):</b></td><td><b>${q}</b></td><td><b>0,00</b></td></tr></tbody></table>`;
    let total = 0; let out = '';
    for (const id of ids) {
      const nome = EVENTOS[id];
      let qtd = 0; let blocos = '';
      if (nome === 'BLOCO VUMBORA SABADO (14/11)') {
        const ing = 2980 + st.vendasExtra;
        if (cortesia) { blocos += `<h5>CORTESIA</h5>${tab([['CORTESIA VUMBORA 14/11', '0,00', '430', '0,00']], 'CORTESIA', 430)}`; qtd += 430; }
        blocos += `<h5>INGRESSO</h5>${tab([['5º LOTE PACOTE VUMBORA 14/11', '550,00', '102', '56.100,00'], ['4º LOTE BLOCO VUMBORA 14/11', '600,00', '2.878', '1.726.800,00'], ['LOTE EXTRA BANESE CARD VUMBORA 14/11', '650,00', String(st.vendasExtra), '202.800,00']], 'INGRESSO', ing.toLocaleString('pt-BR'))}`;
        blocos += `<h5>PACOTE</h5>${tab([['1º LOTE PACOTE VUMBORA 14/11 PROMOCIONAL', '470,00', '662', '311.140,00'], ['2º LOTE PACOTE VUMBORA 14/11', '480,00', '432', '207.360,00']], 'PACOTE', '1.094')}`;
        qtd += ing + 1094;
      } else if (nome === 'BLOCO VUMBORA PACOTE') {
        blocos += `<h5>PACOTE</h5>${tab([['PACOTE VUMBORA 2 DIAS', '900,00', '210', '189.000,00']], 'PACOTE', 210)}`; qtd += 210;
      } else if (nome === 'CAMAROTE AJU SEXTA (13/11)') {
        if (cortesia) { blocos += `<h5>CORTESIA</h5>${tab([['CORTESIA CAMAROTE 13/11', '0,00', '95', '0,00']], 'CORTESIA', 95)}`; qtd += 95; }
        blocos += `<h5>INGRESSO</h5>${tab([['1º LOTE INTEIRA', '300,00', '700', '210.000,00'], ['LOTE EXTRA EXCLUSIVO BANESE CARD INTEIRA', '320,00', '140', '44.800,00'], ['LOTE EXTRA EXCLUSIVO BANESE CARD MEIA', '160,00', '88', '14.080,00'], ['LOTE EXTRA EXCLUSIVO BANESE CARD SOLIDARIA', '180,00', '41', '7.380,00']], 'INGRESSO', 969)}`;
        qtd += 969;
      } else { blocos += `<h5>INGRESSO</h5>${tab([['LOTE UNICO', '10,00', '7', '70,00']], 'INGRESSO', 7)}`; qtd += 7; }
      total += qtd;
      out += `<div class="panel"><div class="panel-heading"><strong>${nome}</strong></div>${blocos}<div class="total-evento"><span>Total Evento ${nome} :</span><span>Qtd: ${qtd.toLocaleString('pt-BR')} | R$ 1,00</span></div></div>`;
    }
    return `<html><body>${topo}<h1>Relatório</h1><h3>Período: 30/10/2025 à ${hoje()}</h3>
      <div class="panel-heading">Vendas por Evento ${cortesia ? 'com' : 'sem'} Cortesias</div>${out}
      <div class="total-geral"><span>Total Geral:</span><span>Qtd: ${total.toLocaleString('pt-BR')} | R$ 2,00</span></div></body></html>`;
  }

  const selecao = `<html><head><style>.oculto{display:none}.card{border:1px solid #ccc;padding:12px;margin:6px;width:300px;display:inline-block}
      .switch{display:inline-block;position:relative;width:50px;height:24px}.switch input{opacity:0;width:0;height:0}.slider{position:absolute;inset:0;background:#ccc;border-radius:24px;cursor:pointer}</style></head><body>${topo}
    <div class="panel-heading"><span>Selecionar Eventos</span>
      <span class="badge" id="cont">0 selecionados</span>
      <label class="switch"><input type="checkbox" id="chkCortesia"><span class="slider"></span></label>
      <strong id="lblCortesia">Sem Cortesia</strong></div>
    <button id="todos">Selecionar Todos</button> <button id="limpar">Limpar</button> <button id="gerar">Gerar Relatório</button>
    <div><input id="busca" placeholder="Buscar evento por nome..."></div>
    <div id="lista">${EVENTOS.map((n, i) => `<div class="card" data-i="${i}"><input type="checkbox" class="ev" value="${i}"> <strong>${n}</strong><div>15/11/2026</div></div>`).join('')}</div>
    <ul class="pagination"><li><a href="#" data-p="0">«</a></li><li><a href="#" data-p="1">1</a></li><li><a href="#" data-p="2">2</a></li><li><a href="#" data-p="0">»</a></li></ul>
    <form id="f" method="post" action="/Reports/GerarRelatorioEventosDetalhados"><input type="hidden" name="eventos"><input type="hidden" name="comCortesia"></form>
    <script>
      let pag = 1, filtro = '';
      const cards = [...document.querySelectorAll('.card')];
      function desenhar() {
        const vis = cards.filter(c => c.textContent.toLowerCase().includes(filtro));
        cards.forEach(c => c.classList.add('oculto'));
        vis.slice((pag - 1) * ${POR_PAGINA}, pag * ${POR_PAGINA}).forEach(c => c.classList.remove('oculto'));
        document.getElementById('cont').textContent = document.querySelectorAll('.ev:checked').length + ' selecionados';
      }
      document.getElementById('busca').addEventListener('input', e => { filtro = e.target.value.toLowerCase(); pag = 1; desenhar(); });
      document.querySelectorAll('.pagination a').forEach(a => a.addEventListener('click', e => { e.preventDefault(); const p = Number(a.dataset.p); if (p) { pag = p; desenhar(); } }));
      document.querySelectorAll('.ev').forEach(c => c.addEventListener('change', desenhar));
      document.getElementById('limpar').onclick = () => { document.querySelectorAll('.ev').forEach(c => c.checked = false); desenhar(); };
      document.getElementById('chkCortesia').addEventListener('change', e => { document.getElementById('lblCortesia').textContent = e.target.checked ? 'Com Cortesia' : 'Sem Cortesia'; });
      document.getElementById('gerar').onclick = () => {
        const f = document.getElementById('f');
        f.eventos.value = [...document.querySelectorAll('.ev:checked')].map(c => c.value).join(',');
        f.comCortesia.value = document.getElementById('chkCortesia').checked ? '1' : '0';
        f.submit();
      };
      desenhar();
    </script></body></html>`;

  const srv = http.createServer(async (req, res) => {
    const url = req.url.split('?')[0];
    if (req.method === 'POST' && url === '/login') {
      const b = new URLSearchParams(await corpo(req));
      if (b.get('usuario') === 'eric' && b.get('senha') === 'segredo' && b.get('ano') === '2026') {
        st.logins++; const sid = 's' + st.logins; st.sessoes.add(sid);
        return html(res, '', 302, { Location: '/', 'Set-Cookie': `sid=${sid}; Path=/; HttpOnly` });
      }
      return html(res, '', 302, { Location: '/' });
    }
    if (!logado(req)) {
      if (url !== '/') return html(res, '', 302, { Location: '/' });
      return html(res, `<html><body><h3>LOG IN</h3><form method="post" action="/login"><input type="text" name="usuario"><input type="password" name="senha">
        <select name="ano"><option>2025</option><option selected>2026</option></select><button type="submit">ENTRAR</button></form></body></html>`);
    }
    if (url === '/') return html(res, `<html><body>${topo}<h1>RESUMO</h1><p>Vendas HOJE</p></body></html>`);
    if (url === '/Reports/VendasEventosDetalhados/') return html(res, selecao);
    if (url === '/Reports/GerarRelatorioEventosDetalhados' && req.method === 'POST') {
      const raw = await corpo(req); st.ultimoPost = raw; st.relatorios++;
      const b = new URLSearchParams(raw);
      const ids = (b.get('eventos') || '').split(',').filter(Boolean).map(Number);
      const h = relatorio(ids, b.get('comCortesia') === '1');
      if (sessaoCurta) st.sessoes.clear(); // simula a sessão caindo logo depois
      return html(res, h);
    }
    html(res, 'nao encontrado', 404);
  });
  return { srv, st, ouvir: () => new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${srv.address().port}`))) };
}
module.exports = { criar, EVENTOS };
