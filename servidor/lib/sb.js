// Cliente mínimo do Supabase (REST). Usa a chave de serviço, que só existe no servidor.
function criarSb({ url, key }) {
  const base = String(url || '').replace(/\/$/, '') + '/rest/v1/';
  async function chamar(metodo, caminho, corpo, prefer) {
    const r = await fetch(base + caminho, {
      method: metodo,
      headers: { apikey: key, ...(String(key).startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json', Prefer: prefer || 'return=minimal' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(20000),
    });
    const txt = await r.text();
    if (!r.ok) throw new Error(`Supabase ${metodo} ${caminho.split('?')[0]}: ${r.status} ${txt.slice(0, 200)}`);
    return txt ? JSON.parse(txt) : null;
  }
  return {
    config: async () => (await chamar('GET', 'lm_config?id=eq.1&select=*'))?.[0] || null,
    status: (campos) => chamar('PATCH', 'lm_status?id=eq.1', campos),
    leituras: (linhas) => chamar('POST', 'lm_leituras', linhas),
    alerta: (linha) => chamar('POST', 'lm_alertas', linha),
    diario: (linhas) => chamar('POST', 'lm_diario?on_conflict=dia,alvo_id', linhas, 'resolution=merge-duplicates,return=minimal'),
    // leituras entre duas datas (paginadas por id), para o backup
    leiturasEntre: async (de, ate) => {
      const tudo = []; let apos = 0;
      for (;;) {
        const lote = await chamar('GET', `lm_leituras?select=id,em,alvo_id,alvo_nome,total,variacao,total_geral,meta&em=gte.${encodeURIComponent(de)}&em=lt.${encodeURIComponent(ate)}&id=gt.${apos}&order=id.asc&limit=1000`);
        tudo.push(...lote); if (lote.length < 1000) return tudo; apos = lote[lote.length - 1].id;
      }
    },
    limparAntigas: (antesDe) => chamar('DELETE', `lm_leituras?em=lt.${encodeURIComponent(antesDe)}`),
  };
}
module.exports = { criarSb };
