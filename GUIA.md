# Monitor de Lotes na nuvem — passo a passo

Visão geral: o **robô** roda na Oracle (Docker) e grava no **Supabase**; o **app** (GitHub Pages) lê do Supabase com login, como o PointBot. O alarme sonoro toca no app aberto; com o app fechado o aviso vai pelo **Telegram**.

> O PointBot **não é alterado**. Este projeto usa pastas, container e tabelas próprias (`lm_*`). Usa o mesmo projeto Supabase só se você quiser (recomendado: mesmo login).

## 1. Supabase (uns 5 min)
1. **SQL Editor** → cole `supabase/01_instalar.sql` → Run.
2. Em **Authentication > Users**, confirme que seu e-mail existe (o do PointBot serve). Abra `supabase/02_primeiro_master.sql`, troque `SEU_EMAIL_AQUI` pelo seu e-mail → Run (deve listar 1 linha).
3. **Edge Functions > Deploy a new function**, nome `lm-admin-users`, cole `supabase/functions/lm-admin-users/index.ts` → Deploy. (Ela permite ao master criar/remover usuários pelo app.)
4. **Project Settings > API**: anote **Project URL**, **anon key** (pública, vai no app) e **service_role key** (SECRETA, vai só no servidor).

## 2. Telegram (2 min)
1. No Telegram, fale com **@BotFather** → `/newbot` → guarde o **token**.
2. Mande qualquer mensagem ao seu bot novo e abra `https://api.telegram.org/bot<TOKEN>/getUpdates` → copie o número de `"chat":{"id":...}` (é o **chat_id**; para grupo, é negativo).

## 3. App no GitHub Pages (5 min)
1. Edite `app/config.js` com **Project URL** e **anon key** (nunca a service_role).
2. Crie um repositório (pode ser privado se seu plano permitir Pages; senão público — o app só tem a chave anon, que é pública por design) e envie **esta pasta inteira**.
3. **Settings > Pages > Source = GitHub Actions**. O workflow `.github/workflows/pages.yml` publica sozinho. O link aparece em Actions.
4. Abra o link no celular e use **Adicionar à tela inicial** (instala como app).

## 4. Servidor na Oracle (10 min)
Na VM Micro (SSH), **sem mexer em /opt/pointbot**:

```bash
# (uma vez) swap de 2 GB — a Micro tem só 1 GB de RAM
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
# (se já existir swap, pule)

sudo mkdir -p /opt/lote-monitor && sudo chown $USER /opt/lote-monitor
# envie a pasta servidor/ para /opt/lote-monitor (scp, git clone, etc.)
cd /opt/lote-monitor
cp .env.example .env && nano .env      # preencha tudo
docker compose up -d --build
docker compose logs -f                 # Ctrl+C para sair
```
Nenhuma porta é aberta: o robô só faz conexões de saída (Supabase, Point, Telegram).

## 5. Primeiro uso
- Entre no app → o selo no topo deve ficar **Servidor online** em ~30 s.
- Aba **Config**: confira eventos, lotes e metas (já vêm os 2 padrões) e ligue o **Telegram** com **Testar Telegram**.
- Aba **Painel**: **Ler agora** força uma leitura; **Testar alarme** libera o som (o navegador exige um toque antes de tocar áudio).
- Quando a meta é atingida: alarme no app aberto + mensagem no Telegram (uma vez por meta; rearma se cair abaixo).

## Dia a dia
- Ver memória: `docker stats --no-stream lote-monitor` (esperado: ~100–200 MiB; o Chrome só abre uns segundos por montagem).
- Atualizar: envie os arquivos novos e `docker compose up -d --build`.
- Parar: `docker compose down`. Logs: `docker compose logs --tail 100`.
- Trocar senha do admin Point: edite `.env` e `docker compose up -d`.

## Problemas comuns
- **"Servidor nunca conectou"**: veja `docker compose logs`; confira `SUPABASE_URL` e a service_role key.
- **Container reiniciando / "Killed"**: falta de RAM; confirme o swap (`free -h`) e que o PointBot não aumentou o uso.
- **Evento não encontrado**: o nome na Config deve ser igual ao da lista do admin, ex.: `[14/11/2026] BLOCO VUMBORA SABADO (14/11)`.
- **Sem som**: toque em **Testar alarme** uma vez; celular em modo silencioso bloqueia áudio (use o Telegram).
