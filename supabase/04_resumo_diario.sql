-- Rode UMA vez no SQL Editor: resumo diário permanente (1 linha por evento por dia, guarda a evolução mesmo após os backups/limpezas)
create table if not exists public.lm_diario (
  dia           date not null,
  alvo_id       text not null,
  alvo_nome     text,
  total         int  not null,   -- lotes monitorados no último valor lido do dia
  total_geral   int,
  meta          int,
  atualizado_em timestamptz not null default now(),
  primary key (dia, alvo_id)
);
alter table public.lm_diario enable row level security;
revoke all on public.lm_diario from anon, authenticated;
grant select on public.lm_diario to authenticated;
grant all on public.lm_diario to service_role;
drop policy if exists lm_diario_ler on public.lm_diario;
create policy lm_diario_ler on public.lm_diario for select to authenticated using (public.lm_papel() is not null);
