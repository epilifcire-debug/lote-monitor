// Avisos no Telegram (opcional). Sem TOKEN/CHAT_ID configurados, não envia nada.
function criarTelegram({ token, chatId, api }) {
  const base = (api || 'https://api.telegram.org').replace(/\/$/, '');
  const configurado = !!(token && chatId);
  async function enviar(texto) {
    if (!configurado) return false;
    const r = await fetch(`${base}/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: texto, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`Telegram respondeu ${r.status}: ${(await r.text()).slice(0, 150)}`);
    return true;
  }
  async function enviarArquivo(nome, conteudo, legenda) {
    if (!configurado) return false;
    const f = new FormData();
    f.append('chat_id', String(chatId)); if (legenda) f.append('caption', legenda);
    f.append('document', new Blob([conteudo], { type: 'text/csv' }), nome);
    const r = await fetch(`${base}/bot${token}/sendDocument`, { method: 'POST', body: f, signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`Telegram respondeu ${r.status}: ${(await r.text()).slice(0, 150)}`);
    return true;
  }
  return { enviar, enviarArquivo, configurado };
}
module.exports = { criarTelegram };
