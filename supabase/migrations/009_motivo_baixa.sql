-- 009: Motivo pendente de baixa no item
-- Devolução/Descarte (comercial) enviam o item para "Bloqueados" com o motivo;
-- a logística lança a NF e o motivo é levado para o registro de baixa.

alter table itens add column if not exists motivo_baixa text;
