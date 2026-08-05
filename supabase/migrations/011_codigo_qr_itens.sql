-- 011: Código QR por item (IT-000123) — atribuição AUTOMÁTICA a todos os itens
-- ------------------------------------------------------------------------
-- Substitui o registro separado de paletes: o próprio item do estoque passa a
-- ter um código de QR para verificação, validação e inspeção.
-- Seguro para reexecutar.

-- Sequência que numera os códigos
create sequence if not exists itens_codigo_qr_seq;

-- Coluna do código do QR
alter table itens add column if not exists codigo_qr text;

-- Backfill: todos os itens SEM código recebem um, em ordem de cadastro,
-- usando a própria sequência (para que os novos inserts continuem a numeração).
do $mig$
declare r record;
begin
  for r in select id from itens where codigo_qr is null order by created_at, id loop
    update itens
      set codigo_qr = 'IT-' || lpad(nextval('itens_codigo_qr_seq')::text, 6, '0')
      where id = r.id;
  end loop;
end $mig$;

-- Unicidade do código
create unique index if not exists idx_itens_codigo_qr on itens(codigo_qr);

-- Novos itens já nascem com o código (trigger BEFORE INSERT)
create or replace function set_item_codigo_qr() returns trigger as $fn$
begin
  if new.codigo_qr is null then
    new.codigo_qr := 'IT-' || lpad(nextval('itens_codigo_qr_seq')::text, 6, '0');
  end if;
  return new;
end;
$fn$ language plpgsql;

drop trigger if exists tr_itens_codigo_qr on itens;
create trigger tr_itens_codigo_qr
  before insert on itens
  for each row execute function set_item_codigo_qr();
