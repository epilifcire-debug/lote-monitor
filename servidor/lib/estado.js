// Memória local do serviço (último total de cada alvo e se a meta já foi avisada). Fica em data/estado.json.
const fs = require('fs');
const path = require('path');

function criarEstado(dir) {
  const arq = path.join(dir, 'estado.json');
  let e = {};
  try { e = JSON.parse(fs.readFileSync(arq, 'utf8')); } catch {}
  const salvar = () => { try { fs.writeFileSync(arq, JSON.stringify(e, null, 2)); } catch {} };
  return {
    de: (id) => e[id] || {},
    gravar: (id, campos) => { e[id] = { ...(e[id] || {}), ...campos }; salvar(); },
  };
}

// Dispara uma vez ao atingir a meta. Rearma se o total cair abaixo dela ou se a meta for alterada.
function avaliarMeta(total, meta, est) {
  const jaAvisou = !!est.alertado && est.metaAvisada === meta;
  if (meta > 0 && total >= meta) return { disparar: !jaAvisou, alertado: true };
  return { disparar: false, alertado: false };
}
module.exports = { criarEstado, avaliarMeta };
