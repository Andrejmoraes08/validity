-- 010: Tipo estruturado no histórico
-- Classifica cada evento por tipo (Inspeção, Bloqueio, Baixa, Quarentena, etc.).
-- Um trigger preenche o tipo automaticamente a cada inserção — sem alterar o app.

alter table historico add column if not exists tipo text;

-- Função de classificação (usada no backfill e no trigger)
create or replace function classificar_evento(desc_texto text) returns text as $$
begin
  return case
    when desc_texto ilike 'inspeção complementar%'   then 'Inspeção Complementar'
    when desc_texto ilike 'inspeção%'                then 'Inspeção'
    when desc_texto ilike 'baixa de endereço%'       then 'Baixa de Endereço'
    when desc_texto ilike 'baixa%'                   then 'Baixa'
    when desc_texto ilike 'quarentena%'              then 'Quarentena'
    when desc_texto ilike 'enviado para quarentena%' then 'Quarentena'
    when desc_texto ilike 'estorno%'                 then 'Estorno'
    when desc_texto ilike '%bloqueado%' or desc_texto ilike '%bloqueio%' then 'Bloqueio'
    when desc_texto ilike 'importação%' or desc_texto ilike 'wms%'        then 'Importação'
    when desc_texto ilike '%usuário%'                then 'Usuário'
    when desc_texto ilike '📧%'                      then 'Notificação'
    else 'Geral'
  end;
end;
$$ language plpgsql immutable;

-- Backfill dos eventos existentes
update historico set tipo = classificar_evento(descricao) where tipo is null;

-- Trigger: classifica cada novo evento (respeita tipo já informado, se houver)
create or replace function set_historico_tipo() returns trigger as $$
begin
  if new.tipo is null then
    new.tipo := classificar_evento(new.descricao);
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_historico_tipo on historico;
create trigger trg_historico_tipo before insert on historico
  for each row execute function set_historico_tipo();
