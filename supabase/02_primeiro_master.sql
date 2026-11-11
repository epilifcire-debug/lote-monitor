-- Dá acesso de MASTER ao seu usuário. Troque o e-mail abaixo pelo e-mail com que você entra (o mesmo do painel do PointBot serve).
-- O usuário precisa existir em Authentication > Users. Se não existir, crie lá antes (Add user > Create new user).
insert into public.lm_papeis (user_id, papel, nome)
select id, 'master', 'Master' from auth.users where email = 'SEU_EMAIL_AQUI'
on conflict (user_id) do update set papel = 'master';

-- Confere (deve aparecer 1 linha):
select u.email, p.papel from public.lm_papeis p join auth.users u on u.id = p.user_id;
