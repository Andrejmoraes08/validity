-- 005: Inspeções numeradas e persistidas + fotos no Storage
-- Permite retomar a inspeção de onde parou e garante uma inspeção aberta por vez.

create table if not exists inspecoes (
  id uuid primary key default gen_random_uuid(),
  numero serial,
  responsavel text not null,
  status text not null default 'aberta', -- aberta | concluida | cancelada
  fila jsonb not null default '[]',
  atual integer not null default 0,
  resultados jsonb not null default '[]',
  iniciada_em timestamptz not null default now(),
  finalizada_em timestamptz,
  user_id uuid references auth.users(id)
);

alter table inspecoes enable row level security;

drop policy if exists "inspecoes_select" on inspecoes;
drop policy if exists "inspecoes_insert" on inspecoes;
drop policy if exists "inspecoes_update" on inspecoes;

create policy "inspecoes_select" on inspecoes for select to authenticated using (auth.uid() is not null);
create policy "inspecoes_insert" on inspecoes for insert to authenticated with check (auth.uid() is not null);
create policy "inspecoes_update" on inspecoes for update to authenticated using (auth.uid() is not null);

-- URL da última foto de inspeção do item
alter table itens add column if not exists foto_inspecao text;

-- Bucket público para fotos de inspeção
insert into storage.buckets (id, name, public)
values ('fotos-inspecao', 'fotos-inspecao', true)
on conflict (id) do nothing;

drop policy if exists "fotos_inspecao_upload" on storage.objects;
drop policy if exists "fotos_inspecao_read" on storage.objects;

create policy "fotos_inspecao_upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fotos-inspecao');

create policy "fotos_inspecao_read" on storage.objects
  for select using (bucket_id = 'fotos-inspecao');
