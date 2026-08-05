-- 012: Remove o registro separado de paletes.
-- O controle por QR passou a viver no próprio item (itens.codigo_qr, migration 011).
-- As tabelas estavam vazias em produção. Seguro para reexecutar.

drop table if exists movimentacoes;
drop table if exists paletes;
