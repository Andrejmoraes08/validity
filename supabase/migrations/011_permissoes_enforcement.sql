-- 011: Enforcement das permissões no banco (defesa real, não só UI)
-- Valida as transições de status sensíveis e a exclusão de itens contra a
-- permissão do usuário atual. Admin e chamadas de servidor (service_role) passam.

-- Retorna true se o usuário atual pode executar a ação identificada por `perm`.
-- - Sem contexto de usuário (service_role / SQL direto) → permitido (servidor confiável)
-- - Admin → sempre permitido
-- - Operador → precisa da permissão explícita em perfis.permissoes
create or replace function auth_pode(perm text) returns boolean as $$
declare
  v_role text;
  v_perms text[];
begin
  if auth.uid() is null then
    return true;
  end if;
  select role, permissoes into v_role, v_perms from perfis where user_id = auth.uid();
  if v_role is null then
    return false;
  end if;
  if v_role = 'admin' then
    return true;
  end if;
  return perm = any(coalesce(v_perms, '{}'));
end;
$$ language plpgsql stable security definer set search_path = public;

-- Bloqueia transições de status para quem não tem a permissão correspondente.
-- Transições não listadas (ex.: atualização de saldo/validade na importação) passam livres.
create or replace function itens_check_transicao() returns trigger as $$
begin
  if old.status is distinct from new.status then
    if    old.status = 'segregado'  and new.status = 'bloqueado'  and not auth_pode('plano.bloquear')            then raise exception 'Sem permissão para confirmar bloqueio';
    elsif old.status = 'segregado'  and new.status = 'quarentena' and not auth_pode('plano.quarentena')          then raise exception 'Sem permissão para enviar à quarentena';
    elsif old.status = 'segregado'  and new.status = 'ativo'      and not auth_pode('plano.estornar')            then raise exception 'Sem permissão para estornar';
    elsif old.status = 'quarentena' and new.status = 'bloqueado'  and not auth_pode('plano.quarentena_resolver') then raise exception 'Sem permissão para resolver quarentena';
    elsif old.status = 'bloqueado'  and new.status = 'baixado'    and not auth_pode('bloqueios.baixar')          then raise exception 'Sem permissão para registrar baixa';
    elsif old.status = 'ativo'      and new.status = 'segregado'  and not auth_pode('inspecao.segregar')         then raise exception 'Sem permissão para segregar';
    elsif old.status = 'ativo'      and new.status = 'baixado'    and not auth_pode('inspecao.baixar')           then raise exception 'Sem permissão para baixar endereço';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_itens_transicao on itens;
create trigger trg_itens_transicao before update on itens
  for each row execute function itens_check_transicao();

-- Exclusão de item exige a permissão de excluir
create or replace function itens_check_delete() returns trigger as $$
begin
  if not auth_pode('estoque.excluir') then
    raise exception 'Sem permissão para excluir item';
  end if;
  return old;
end;
$$ language plpgsql;

drop trigger if exists trg_itens_delete on itens;
create trigger trg_itens_delete before delete on itens
  for each row execute function itens_check_delete();
