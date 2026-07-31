-- 012: Senha provisória — força troca no primeiro acesso
-- Usuários criados pelo admin nascem com senha_provisoria = true;
-- ao trocar a senha, vira false.

alter table perfis add column if not exists senha_provisoria boolean not null default false;
