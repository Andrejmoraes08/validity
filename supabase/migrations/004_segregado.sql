-- 004: Status "segregado"
-- Item apartado durante a inspeção; bloqueio é confirmado somente no Plano de Ação.

-- Remove restrição de status, se existir (permite o novo valor 'segregado')
alter table itens drop constraint if exists itens_status_check;

-- Campos de rastreio da segregação
alter table itens add column if not exists segregado_em timestamptz;
alter table itens add column if not exists segregado_por text;
