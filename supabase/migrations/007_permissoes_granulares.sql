-- 007: Permissões granulares por ação (além do acesso à aba)
-- Ex.: ver Plano de Ação mas não confirmar bloqueio; ver mas não estornar.

alter table perfis add column if not exists permissoes text[] not null default '{}';

-- Backfill: perfis existentes recebem TODAS as permissões (mantém o comportamento atual).
-- O admin depois desmarca as ações que quiser restringir.
update perfis set permissoes = array[
  'plano.ver_zonas', 'plano.ver_segregados', 'plano.bloquear', 'plano.estornar', 'plano.exportar',
  'inspecao.segregar', 'inspecao.baixar',
  'estoque.cadastrar', 'estoque.editar', 'estoque.excluir',
  'bloqueios.baixar',
  'wms.importar'
]
where permissoes = '{}' or permissoes is null;
