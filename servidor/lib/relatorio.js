// Leitura do relatório "Vendas por Evento com Cortesias" a partir do HTML (sem navegador).
const cheerio = require('cheerio');
const { log, norm, nomesDoAlvo } = require('./util');

const num = (v) => parseInt(String(v).replace(/\./g, '').replace(/[^\d]/g, ''), 10);

function parseRelatorio(html) {
  const $ = cheerio.load(String(html || ''));
  $('script,style,noscript').remove();
  const temLogin = $('input[type=password]').length > 0;

  // texto com um espaço entre células/elementos (senão "430" e "0,00" grudam em "4300,00")
  $('td,th,div,p,li,br,tr,h1,h2,h3,h4,h5,h6,span,strong,b').each((_, e) => { $(e).append(' '); });
  const txt = $('body').text().replace(/\s+/g, ' ');

  const g = txt.match(/Total\s+Geral\s*:?[\s\S]{0,40}?Qtd\s*:?\s*([\d.]+)/i);
  // subtotais (categorias) vêm ANTES do "Total Evento" do evento a que pertencem
  const re = /Subtotal\s*\(\s*([^)]+?)\s*\)\s*:?\s*([\d.]+)|Total\s+Evento\s+(.+?)\s*:[\s\S]{0,40}?Qtd\s*:?\s*([\d.]+)/gi;
  const eventos = []; let pend = []; let m;
  while ((m = re.exec(txt))) {
    if (m[1]) pend.push({ nome: m[1].trim().toUpperCase(), qtd: num(m[2]) });
    else { eventos.push({ nome: m[3].trim(), qtd: num(m[4]), categorias: pend }); pend = []; }
  }

  const lotes = [];
  $('table').each((_, tb) => {
    const proprias = $(tb).find('tr').toArray().filter((tr) => $(tr).closest('table')[0] === tb); // ignora tabelas aninhadas
    const cab = proprias.find((tr) => $(tr).children('th').length > 1);
    const ths = cab ? $(cab).children('th').toArray().map((h) => norm($(h).text())) : [];
    let idx = ths.findIndex((t) => ['qtd', 'qtde', 'quantidade', 'qtde.'].includes(t));
    if (idx < 0) idx = 2;
    proprias.forEach((tr) => {
      const cs = $(tr).children('td').toArray();
      if (cs.length < 3) return;
      const nome = $(cs[0]).text().trim().replace(/\s+/g, ' ');
      if (!nome || /^(sub)?total/i.test(nome)) return;
      const q = num($(cs[idx]).text());
      if (!Number.isNaN(q)) lotes.push({ nome, qtd: q });
    });
  });

  const p = txt.match(/Per[ií]odo\s*:?\s*(\d{2}\/\d{2}\/\d{4})\s*(?:à|a|até|-)\s*(\d{2}\/\d{2}\/\d{4})/i);

  return {
    periodoInicio: p ? p[1] : null, periodoFim: p ? p[2] : null,
    geral: g ? num(g[1]) : null, eventos, lotes, temLogin,
    comCortesias: /vendas\s+por\s+evento\s+com\s+cortesias?/i.test(txt),
  };
}

// Confere se o HTML é mesmo o relatório certo. Lança erro explicando o motivo.
function validarRelatorio(rel) {
  if (rel.temLogin) throw new Error('a sessão do admin expirou (voltou para a tela de login)');
  if (!rel.comCortesias) throw new Error('o relatório não é "Vendas por Evento com Cortesias"');
  if (rel.geral == null) throw new Error('"Total Geral" não encontrado no relatório');
  return rel;
}

// Transforma o relatório lido nos resultados de cada alvo (função pura).
// estrito = true (releitura rápida): evento ausente => erro, para remontar. false (recém-montado): ausente é conciliado pelo Total Geral.
function montarResultados(alvos, rel, estrito) {
  const todos = [...new Set(alvos.flatMap(nomesDoAlvo))];
  const acha = (n) => rel.eventos.find((e) => norm(e.nome) === norm(n)) || rel.eventos.find((e) => norm(e.nome).includes(norm(n)));
  const qtdEvento = {};
  const faltando = [];
  for (const n of todos) { const e = acha(n); if (e) qtdEvento[n] = e.qtd; else faltando.push(n); }

  if (faltando.length) {
    if (estrito) throw new Error(`evento(s) fora do relatório: ${faltando.join(', ')}`);
    const somaLinhas = rel.eventos.reduce((t, e) => t + e.qtd, 0);
    const dif = rel.geral - somaLinhas;
    if (dif < 0 || (dif > 0 && faltando.length > 1)) {
      throw new Error(`Total Geral (${rel.geral}) não bate com os eventos achados (${somaLinhas}). Faltou no relatório: ${faltando.join(', ')}. Eventos no relatório: ${rel.eventos.map((e) => e.nome).join(', ') || 'nenhum'}`);
    }
    log(`Aviso: "${faltando.join(', ')}" sem Total Evento próprio no relatório; diferença para o Total Geral = ${dif}`);
    for (const n of faltando) qtdEvento[n] = faltando.length === 1 ? dif : 0;
  } else {
    const soma = rel.eventos.reduce((t, e) => t + e.qtd, 0);
    if (soma !== rel.geral) log(`Aviso: soma dos eventos (${soma}) difere do Total Geral do relatório (${rel.geral})`);
  }

  return alvos.map((alvo) => {
    try {
      const nomes = nomesDoAlvo(alvo);
      const porEvento = nomes.map((n) => ({ nome: n, qtd: qtdEvento[n] }));
      const totalGeral = porEvento.reduce((t, e) => t + e.qtd, 0);
      const cat = {};
      for (const n of nomes) for (const c of (acha(n)?.categorias || [])) cat[c.nome] = (cat[c.nome] || 0) + c.qtd;
      const categorias = Object.entries(cat).map(([nome, qtd]) => ({ nome, qtd }));

      const detalhe = alvo.lotes.map((lote) => {
        const exatas = rel.lotes.filter((l) => norm(l.nome) === norm(lote));
        const linhas = exatas.length ? exatas : rel.lotes.filter((l) => norm(l.nome).includes(norm(lote))).slice(0, 1);
        if (linhas.length > 1) log(`Aviso: "${lote}" aparece em ${linhas.length} linhas do relatório; somando (${linhas.map((l) => l.qtd).join(' + ')})`);
        return linhas.length ? { lote, qtd: linhas.reduce((t, l) => t + l.qtd, 0), encontrado: true, linhas: linhas.length } : { lote, qtd: 0, encontrado: false, linhas: 0 };
      });
      if (!detalhe.some((d) => d.encontrado)) {
        const parecidos = rel.lotes.filter((l) => /extra|banese/i.test(l.nome)).map((l) => l.nome).slice(0, 6);
        throw new Error(`Nenhum lote de "${alvo.nome}" encontrado no relatório.${parecidos.length ? ` Lotes parecidos que apareceram: ${parecidos.join(' | ')}` : ''}`);
      }
      for (const d of detalhe) if (!d.encontrado) log(`Aviso: "${d.lote}" não aparece no relatório; considerado 0`);
      const total = detalhe.reduce((t, d) => t + d.qtd, 0);
      log(`${alvo.nome}: lotes ${total} (${detalhe.map((d) => d.qtd).join(' + ')}) | total geral com cortesias ${totalGeral}`);
      return { alvo, total, detalhe, totalGeral, categorias, porEvento };
    } catch (e) {
      log(`ERRO em ${alvo.nome}:`, e.message);
      return { alvo, erro: e.message };
    }
  });
}

module.exports = { parseRelatorio, validarRelatorio, montarResultados };
