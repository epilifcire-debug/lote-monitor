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
    limparAntigas: (antesDe) => chamar('DELETE', `lm_leituras?em=lt.${encodeURIComponent(antesDe)}`),
  };
}
module.exports = { criarSb };
