-- Rode UMA vez no SQL Editor (instalações que já existem): leitura a cada 10 s a 1 h
alter table public.lm_config add column if not exists intervalo_seg int not null default 30 check (intervalo_seg between 10 and 3600);
grant update (ativo, intervalo_min, intervalo_seg, telegram_ativo, alvos, pedir_leitura_em, pedir_teste_em, atualizado_em) on public.lm_config to authenticated;
update public.lm_config set intervalo_seg = 30 where id = 1;
