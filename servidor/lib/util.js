const log = (...a) => console.log(`[${new Date().toLocaleString('pt-BR', { timeZone: process.env.TZ || 'America/Maceio' })}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const nomeCurto = (ev) => String(ev).replace(/^\s*\[[^\]]*\]\s*/, '').trim(); // "[14/11/2026] BLOCO X" -> "BLOCO X"
const nomesDoAlvo = (a) => (a.totalGeralEventos && a.totalGeralEventos.length ? a.totalGeralEventos : [a.evento]).map(nomeCurto);
// data de hoje (dd/mm/aaaa) no fuso do evento
const hojeBR = () => new Intl.DateTimeFormat('pt-BR', { timeZone: process.env.TZ || 'America/Maceio', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
module.exports = { log, sleep, norm, nomeCurto, nomesDoAlvo, hojeBR };
