-- 006: Normalização de endereços para o padrão "Rua - Prédio - Nível - Apto"
-- Corrige endereços incompletos ("6 - 53 - 4 -" → "6 - 53 - 4 - 0") e
-- remove registros duplicados criados pela diferença de formato.

-- Função de normalização: 4 segmentos, segmento vazio vira 0
create or replace function normalizar_endereco(e text) returns text as $$
declare
  partes text[];
  resultado text[] := '{}';
  p text;
  i int;
begin
  if e is null or btrim(e) = '' then
    return '';
  end if;
  partes := string_to_array(e, '-');
  for i in 1..4 loop
    if i <= coalesce(array_length(partes, 1), 0) then
      p := btrim(partes[i]);
    else
      p := '';
    end if;
    if p = '' then p := '0'; end if;
    resultado := array_append(resultado, p);
  end loop;
  return array_to_string(resultado, ' - ');
end;
$$ language plpgsql immutable;

-- ─────────────────────────────────────────────────────────────
-- 1) Normaliza o formato dos endereços existentes
-- ─────────────────────────────────────────────────────────────
update itens set endereco_frac = normalizar_endereco(endereco_frac)
  where endereco_frac <> '' and endereco_frac <> normalizar_endereco(endereco_frac);

update itens set endereco_gran = normalizar_endereco(endereco_gran)
  where endereco_gran <> '' and endereco_gran <> normalizar_endereco(endereco_gran);

-- ─────────────────────────────────────────────────────────────
-- 2) Duplicados por (sku, endereco_frac) entre itens ativos
--    Mantém o registro mais completo (com endereco_gran) ou o mais recente,
--    copiando para ele o saldo/validade do registro atualizado por último.
-- ─────────────────────────────────────────────────────────────
with ranked as (
  select id, sku, endereco_frac, quantidade, validade,
    row_number() over (partition by sku, endereco_frac
      order by (endereco_gran <> '') desc, updated_at desc) as keep_rank,
    row_number() over (partition by sku, endereco_frac
      order by updated_at desc) as fresh_rank
  from itens
  where endereco_frac <> '' and status = 'ativo'
),
grupos_dup as (
  select sku, endereco_frac from ranked group by sku, endereco_frac having count(*) > 1
),
manter as (
  select r.id, r.sku, r.endereco_frac from ranked r
  join grupos_dup g using (sku, endereco_frac) where r.keep_rank = 1
),
recente as (
  select r.sku, r.endereco_frac, r.quantidade, r.validade from ranked r
  join grupos_dup g using (sku, endereco_frac) where r.fresh_rank = 1
)
update itens i
set quantidade = rc.quantidade, validade = rc.validade
from manter m
join recente rc using (sku, endereco_frac)
where i.id = m.id;

-- Registra os duplicados a remover
create temp table _dup_remover (id uuid);

insert into _dup_remover
with ranked as (
  select id, sku, endereco_frac,
    row_number() over (partition by sku, endereco_frac
      order by (endereco_gran <> '') desc, updated_at desc) as keep_rank
  from itens
  where endereco_frac <> '' and status = 'ativo'
)
select id from ranked where keep_rank > 1;

-- ─────────────────────────────────────────────────────────────
-- 3) Duplicados por (sku, endereco_gran) entre itens ativos
-- ─────────────────────────────────────────────────────────────
with ranked as (
  select id, sku, endereco_gran, quantidade, validade,
    row_number() over (partition by sku, endereco_gran
      order by (endereco_frac <> '') desc, updated_at desc) as keep_rank,
    row_number() over (partition by sku, endereco_gran
      order by updated_at desc) as fresh_rank
  from itens
  where endereco_gran <> '' and status = 'ativo'
    and id not in (select id from _dup_remover)
),
grupos_dup as (
  select sku, endereco_gran from ranked group by sku, endereco_gran having count(*) > 1
),
manter as (
  select r.id, r.sku, r.endereco_gran from ranked r
  join grupos_dup g using (sku, endereco_gran) where r.keep_rank = 1
),
recente as (
  select r.sku, r.endereco_gran, r.quantidade, r.validade from ranked r
  join grupos_dup g using (sku, endereco_gran) where r.fresh_rank = 1
)
update itens i
set quantidade = rc.quantidade, validade = rc.validade
from manter m
join recente rc using (sku, endereco_gran)
where i.id = m.id;

insert into _dup_remover
with ranked as (
  select id, sku, endereco_gran,
    row_number() over (partition by sku, endereco_gran
      order by (endereco_frac <> '') desc, updated_at desc) as keep_rank
  from itens
  where endereco_gran <> '' and status = 'ativo'
    and id not in (select id from _dup_remover)
)
select id from ranked where keep_rank > 1;

-- ─────────────────────────────────────────────────────────────
-- 4) Remove os duplicados (desvincula baixas antes, por segurança)
-- ─────────────────────────────────────────────────────────────
update baixas set item_id = null where item_id in (select id from _dup_remover);

delete from itens where id in (select id from _dup_remover);

drop table _dup_remover;

-- ─────────────────────────────────────────────────────────────
-- 5) Verificação — todas as contagens devem retornar 0
-- ─────────────────────────────────────────────────────────────
select 'duplicados_frac' as verificacao, count(*) as qtd from (
  select sku, endereco_frac from itens
  where endereco_frac <> '' and status = 'ativo'
  group by sku, endereco_frac having count(*) > 1
) a
union all
select 'duplicados_gran', count(*) from (
  select sku, endereco_gran from itens
  where endereco_gran <> '' and status = 'ativo'
  group by sku, endereco_gran having count(*) > 1
) b
union all
select 'formato_invalido', count(*) from itens
where (endereco_frac <> '' and endereco_frac <> normalizar_endereco(endereco_frac))
   or (endereco_gran <> '' and endereco_gran <> normalizar_endereco(endereco_gran));
