// node teste/rodar.js  -> roda todos os testes (o do robô só roda se houver navegador)
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const testes = ['servico.teste.js'];
const nav = [process.env.PUPPETEER_EXECUTABLE_PATH, '/usr/bin/chromium', '/usr/bin/google-chrome-stable'].find((p) => p && fs.existsSync(p));
if (nav) testes.push('bot.teste.js'); else console.log('(sem navegador: pulando bot.teste.js)');
let falhas = 0;
for (const t of testes) {
  const r = spawnSync(process.execPath, [path.join(__dirname, t)], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PUPPETEER_EXECUTABLE_PATH: nav || '' } });
  const out = String(r.stdout).split('\n').filter((l) => !l.startsWith('[')).join('\n').trim();
  console.log(out || '(sem saída)'); if (r.status !== 0) { falhas++; console.error(String(r.stderr)); }
}
process.exit(falhas ? 1 : 0);
