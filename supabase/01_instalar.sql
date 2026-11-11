-- Monitor de Lotes — instalação no Supabase (SQL Editor > New query > colar tudo > Run)
-- Pode rodar mais de uma vez sem estragar nada. Todas as tabelas começam com "lm_" para não misturar com as do PointBot.

-- 1) Quem pode entrar no app -------------------------------------------------
create table if not exists public.lm_papeis (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  papel     text not null check (papel in ('master', 'admin')),
  nome      text,
  criado_em timestamptz not null default now()
);

create or replace function public.lm_papel() returns text
language sql stable security definer set search_path = public as
$$ select papel from public.lm_papeis where user_id = auth.uid() $$;
revoke all on function public.lm_papel() from public, anon;
grant execute on function public.lm_papel() to authenticated;

-- 2) Configuração (uma linha só) ---------------------------------------------
create table if not exists public.lm_config (
  id               int primary key default 1 check (id = 1),
  ativo            boolean not null default true,
  intervalo_min    int not null default 5 check (intervalo_min between 1 and 60),
  telegram_ativo   boolean not null default true,
  alvos            jsonb not null default '[]'::jsonb,
  pedir_leitura_em timestamptz,
  pedir_teste_em   timestamptz,
  atualizado_em    timestamptz not null default now()
);

-- 3) Situação do servidor e últimos números (uma linha só) --------------------
create table if not exists public.lm_status (
  id                   int primary key default 1 check (id = 1),
  online_em            timestamptz,
  versao               text,
  telegram_configurado boolean,
  rodando              boolean not null default false,
  ultima_em            timestamptz,
  proxima_em           timestamptz,
  modo                 text,
  ms                   int,
  periodo              text,
  resultados           jsonb not null default '[]'::jsonb,
  erro                 text,
  erro_em              timestamptz
);

-- 4) Histórico de leituras e alertas de meta ----------------------------------
create table if not exists public.lm_leituras (
  id          bigint generated always as identity primary key,
  em          timestamptz not null default now(),
  alvo_id     text not null,
  alvo_nome   text,
  total       int not null,
  variacao    int not null default 0,
  total_geral int,
  meta        int,
  detalhe     jsonb,
  categorias  jsonb,
  por_evento  jsonb
);
create index if not exists lm_leituras_em_idx on public.lm_leituras (em desc);
create index if not exists lm_leituras_alvo_idx on public.lm_leituras (alvo_id, em desc);

create table if not exists public.lm_alertas (
  id          bigint generated always as identity primary key,
  em          timestamptz not null default now(),
  alvo_id     text not null,
  alvo_nome   text,
  total       int not null,
  meta        int not null,
  total_geral int
);

-- 5) Segurança: só usuários cadastrados em lm_papeis enxergam; o servidor grava com a chave de serviço
alter table public.lm_papeis   enable row level security;
alter table public.lm_config   enable row level security;
alter table public.lm_status   enable row level security;
alter table public.lm_leituras enable row level security;
alter table public.lm_alertas  enable row level security;

revoke all on public.lm_papeis, public.lm_config, public.lm_status, public.lm_leituras, public.lm_alertas from anon;
revoke all on public.lm_papeis, public.lm_config, public.lm_status, public.lm_leituras, public.lm_alertas from authenticated;
grant select on public.lm_papeis, public.lm_config, public.lm_status, public.lm_leituras, public.lm_alertas to authenticated;
grant update (ativo, intervalo_min, telegram_ativo, alvos, pedir_leitura_em, pedir_teste_em, atualizado_em) on public.lm_config to authenticated;
grant all on public.lm_papeis, public.lm_config, public.lm_status, public.lm_leituras, public.lm_alertas to service_role;

drop policy if exists lm_papeis_ler on public.lm_papeis;
create policy lm_papeis_ler on public.lm_papeis for select to authenticated
  using (user_id = auth.uid() or public.lm_papel() = 'master');

drop policy if exists lm_config_ler on public.lm_config;
create policy lm_config_ler on public.lm_config for select to authenticated using (public.lm_papel() is not null);
drop policy if exists lm_config_editar on public.lm_config;
create policy lm_config_editar on public.lm_config for update to authenticated
  using (public.lm_papel() is not null) with check (public.lm_papel() is not null and id = 1);

drop policy if exists lm_status_ler on public.lm_status;
create policy lm_status_ler on public.lm_status for select to authenticated using (public.lm_papel() is not null);
drop policy if exists lm_leituras_ler on public.lm_leituras;
create policy lm_leituras_ler on public.lm_leituras for select to authenticated using (public.lm_papel() is not null);
drop policy if exists lm_alertas_ler on public.lm_alertas;
create policy lm_alertas_ler on public.lm_alertas for select to authenticated using (public.lm_papel() is not null);

-- 6) Atualização ao vivo no app ----------------------------------------------
do $$ begin alter publication supabase_realtime add table public.lm_status;  exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.lm_alertas; exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.lm_config;  exception when duplicate_object then null; when undefined_object then null; end $$;

-- 7) Dados iniciais -----------------------------------------------------------
insert into public.lm_status (id) values (1) on conflict (id) do nothing;
insert into public.lm_config (id, alvos) values (1, '[
  {"id": "vumbora", "nome": "Bloco Vumbora Sábado",
   "evento": "[14/11/2026] BLOCO VUMBORA SABADO (14/11)",
   "lotes": ["LOTE EXTRA BANESE CARD VUMBORA 14/11"],
   "totalGeralEventos": ["BLOCO VUMBORA SABADO (14/11)", "BLOCO VUMBORA PACOTE"],
   "meta": 200},
  {"id": "camarote", "nome": "Camarote Aju Sexta",
   "evento": "[13/11/2026] CAMAROTE AJU SEXTA (13/11)",
   "lotes": ["LOTE EXTRA EXCLUSIVO BANESE CARD INTEIRA", "LOTE EXTRA EXCLUSIVO BANESE CARD MEIA", "LOTE EXTRA EXCLUSIVO BANESE CARD SOLIDARIA"],
   "totalGeralEventos": [],
   "meta": 300}
]'::jsonb) on conflict (id) do nothing;
