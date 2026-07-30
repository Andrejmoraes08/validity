-- 008: Quarentena de produtos + motivo da baixa
-- Novo status 'quarentena' (fluxo do Plano de Ação) e motivo na baixa
-- (Devolução ao fornecedor / Descarte).

alter table itens add column if not exists quarentena_em timestamptz;
alter table itens add column if not exists quarentena_por text;

alter table baixas add column if not exists motivo text;

-- Permissões granulares novas — concede aos perfis existentes para não quebrar acesso.
-- (Admin ignora a lista; operador passa a ver/usar a quarentena como já via segregados.)
update perfis
set permissoes = (
  select array(select distinct unnest(
    permissoes || array['plano.ver_quarentena', 'plano.quarentena', 'plano.quarentena_resolver']
  ))
)
where not ('plano.quarentena' = any(permissoes));
