-- =============================================================================
-- «Rumbo» — esquema de base de datos para Supabase (Postgres 15+)
--
-- Cómo usarlo: copia el archivo completo en el SQL Editor de tu proyecto de
-- Supabase y pulsa «Run». Se puede volver a ejecutar sin errores (por ejemplo,
-- tras actualizar la aplicación): no borra datos.
--
-- Diseño:
--   * Los datos viven en el esquema privado «rumbo», que NO se expone por la API.
--   * La única superficie pública son cuatro funciones «public.rumbo_*» con
--     SECURITY DEFINER: rumbo_create_space, rumbo_get_state, rumbo_get_rev y
--     rumbo_mutate. Todas reciben el secreto del enlace; en la base de datos solo
--     se guarda su SHA-256.
--   * Toda escritura pasa por rumbo_mutate: bloquea el espacio (FOR UPDATE),
--     aplica idempotencia por op_id, ejecuta la acción, reproduce el libro de
--     movimientos completo (si toca dinero) e incrementa la revisión.
--   * Importes en céntimos (bigint). Sin extensiones.
-- =============================================================================

-- Roles de Supabase (ya existen en Supabase; se crean solo en entornos de prueba
-- como PGlite para que el script sea idéntico en ambos sitios).
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

create schema if not exists rumbo;
revoke all on schema rumbo from public;
revoke all on schema rumbo from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Tablas
-- -----------------------------------------------------------------------------

create table if not exists rumbo.settings (
  id               int  primary key default 1 check (id = 1),
  max_real_spaces  int  not null default 3 check (max_real_spaces >= 0),
  setup_code       text null
);
insert into rumbo.settings (id) values (1) on conflict (id) do nothing;

create table if not exists rumbo.spaces (
  id          bigint generated always as identity primary key,
  token_hash  text        not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  name_a      text        not null default '',
  name_b      text        not null default '',
  is_demo     boolean     not null default false,
  rev         bigint      not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists spaces_demo_created_idx on rumbo.spaces (is_demo, created_at);

create table if not exists rumbo.tabs (
  id          bigint generated always as identity primary key,
  space_id    bigint      not null references rumbo.spaces (id) on delete cascade,
  name        text        not null check (char_length(name) between 1 and 40),
  position    int         not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists tabs_space_idx on rumbo.tabs (space_id, position);

create table if not exists rumbo.goals (
  id                 bigint generated always as identity primary key,
  space_id           bigint      not null references rumbo.spaces (id) on delete cascade,
  tab_id             bigint      not null references rumbo.tabs (id),
  name               text        not null check (char_length(name) between 1 and 80),
  description        text        not null default '',
  target_cents       bigint      not null check (target_cents > 0 and target_cents <= 100000000000),
  beneficiary        text        not null default 'both' check (beneficiary in ('both', 'a', 'b')),
  priority           text        not null default 'medium' check (priority in ('high', 'medium', 'low')),
  desired_date       date        null,
  notes              text        not null default '',
  status             text        not null default 'active' check (status in ('active', 'paused', 'done', 'archived')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  last_activity_at   timestamptz not null default now(),
  status_changed_at  timestamptz not null default now()
);
create index if not exists goals_space_idx on rumbo.goals (space_id);
create index if not exists goals_tab_idx on rumbo.goals (tab_id);

create table if not exists rumbo.budget_items (
  id            bigint generated always as identity primary key,
  goal_id       bigint not null references rumbo.goals (id) on delete cascade,
  label         text   not null check (char_length(label) between 1 and 80),
  amount_cents  bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  position      int    not null
);
create index if not exists budget_items_goal_idx on rumbo.budget_items (goal_id, position);

create table if not exists rumbo.tasks (
  id            bigint generated always as identity primary key,
  goal_id       bigint      not null references rumbo.goals (id) on delete cascade,
  title         text        not null check (char_length(title) between 1 and 120),
  done          boolean     not null default false,
  assignee      text        null check (assignee in ('a', 'b', 'both')),
  due_date      date        null,
  note          text        not null default '',
  position      int         not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  completed_at  timestamptz null
);
create index if not exists tasks_goal_idx on rumbo.tasks (goal_id, position);

create table if not exists rumbo.movements (
  id              bigint generated always as identity primary key,
  space_id        bigint      not null references rumbo.spaces (id) on delete cascade,
  kind            text        not null check (kind in ('deposit', 'deposit_to_goal', 'allocate', 'release',
                                                       'transfer', 'payment', 'withdrawal')),
  amount_cents    bigint      not null check (amount_cents > 0 and amount_cents <= 100000000000),
  date            date        not null,
  attribution     text        null check (attribution in ('a', 'b', 'joint')),
  note            text        not null default '',
  goal_id         bigint      null references rumbo.goals (id) on delete restrict,
  to_goal_id      bigint      null references rumbo.goals (id) on delete restrict,
  is_initial      boolean     not null default false,
  group_id        text        null,
  status          text        not null default 'valid' check (status in ('valid', 'voided', 'corrected')),
  order_key       bigint      not null,
  corrects_id     bigint      null references rumbo.movements (id),
  replaced_by_id  bigint      null references rumbo.movements (id),
  void_reason     text        not null default '',
  voided_at       timestamptz null,
  created_at      timestamptz not null default now()
);
create index if not exists movements_space_order_idx on rumbo.movements (space_id, order_key, id);
create index if not exists movements_goal_idx on rumbo.movements (goal_id);
create index if not exists movements_to_goal_idx on rumbo.movements (to_goal_id);
create index if not exists movements_group_idx on rumbo.movements (space_id, group_id);

create table if not exists rumbo.ops (
  space_id    bigint      not null references rumbo.spaces (id) on delete cascade,
  op_id       text        not null,
  action      text        not null,
  response    jsonb       not null,
  created_at  timestamptz not null default now(),
  primary key (space_id, op_id)
);

-- Defensa en profundidad: RLS activado y sin políticas (nadie salvo el
-- propietario de las funciones puede leer o escribir directamente).
alter table rumbo.settings     enable row level security;
alter table rumbo.spaces       enable row level security;
alter table rumbo.tabs         enable row level security;
alter table rumbo.goals        enable row level security;
alter table rumbo.budget_items enable row level security;
alter table rumbo.tasks        enable row level security;
alter table rumbo.movements    enable row level security;
alter table rumbo.ops          enable row level security;

-- -----------------------------------------------------------------------------
-- Utilidades: errores, formato, fechas
-- -----------------------------------------------------------------------------

-- Lanza un error de la API. El mensaje es un JSON que el cliente interpreta.
create or replace function rumbo.fail(
  p_code text, p_message text,
  p_fields jsonb default null, p_details jsonb default null, p_current jsonb default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_err jsonb := jsonb_build_object('code', p_code, 'message', p_message);
begin
  if p_fields is not null then
    v_err := v_err || jsonb_build_object('fields', p_fields);
  end if;
  if p_details is not null then
    v_err := v_err || jsonb_build_object('details', p_details);
  end if;
  if p_current is not null then
    v_err := v_err || jsonb_build_object('current', p_current);
  end if;
  raise exception using errcode = 'P0001', message = v_err::text;
end
$$;

-- Si hay errores por campo, lanza «validation».
create or replace function rumbo.require_valid(p_errors jsonb, p_message text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_errors is not null and p_errors <> '{}'::jsonb then
    perform rumbo.fail('validation', coalesce(p_message, 'Revisa los campos marcados.'), p_errors);
  end if;
end
$$;

-- 125050 -> «1.250,50 €» (separador de miles también con cuatro cifras).
create or replace function rumbo.fmt_eur(p_cents bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_cents < 0 then '-' else '' end
         || regexp_replace((abs(p_cents) / 100)::text, '(\d)(?=(\d{3})+$)', '\1.', 'g')
         || ',' || lpad((abs(p_cents) % 100)::text, 2, '0') || ' €'
$$;

-- 2026-03-12 -> «12/03/2026».
create or replace function rumbo.fmt_date(p_date date)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(p_date::timestamp, 'DD/MM/YYYY')
$$;

-- Marca de tiempo ISO en UTC: «2026-03-12T10:20:30Z».
create or replace function rumbo.ts(p_ts timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(timezone(interval '0 hours', p_ts), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
$$;

-- Fecha de hoy en España (con respaldo UTC si no hay datos de zonas horarias).
create or replace function rumbo.today()
returns date
language plpgsql
stable
set search_path = ''
as $$
begin
  return timezone('Europe/Madrid', now())::date;
exception when others then
  return timezone(interval '0 hours', now())::date;
end
$$;

create or replace function rumbo.secret_hash(p_secret text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_secret, 'UTF8')), 'hex')
$$;

create or replace function rumbo.valid_secret(p_secret text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_secret is not null and p_secret ~ '^[A-Za-z0-9_-]{43,128}$'
$$;

-- -----------------------------------------------------------------------------
-- Validación de valores JSON
--
-- Especificaciones de campo:
--   text:MIN:MAX   texto recortado; con MIN = 0, null equivale a ''.
--   amount         entero de céntimos 1..100000000000 ('amount?' admite null).
--   id             entero positivo ('id?' admite null).
--   bool           booleano.
--   date           'AAAA-MM-DD' válida ('date?' admite null o '').
--   enum:a|b|c     uno de los valores ('enum?:…' admite null).
-- Un '!' final en parse_obj marca el campo como obligatorio.
-- Devuelve {"v": valor normalizado} o {"e": "mensaje"}.
-- -----------------------------------------------------------------------------

create or replace function rumbo.parse_field(p_spec text, p_val jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_type      text := split_part(p_spec, ':', 1);
  v_arg1      text := split_part(p_spec, ':', 2);
  v_arg2      text := split_part(p_spec, ':', 3);
  v_nullable  boolean := false;
  v_jt        text := coalesce(jsonb_typeof(p_val), 'null');
  v_txt       text;
  v_num       numeric;
  v_year      int;
  v_month     int;
  v_day       int;
  v_last_day  int;
begin
  if right(v_type, 1) = '?' then
    v_nullable := true;
    v_type := left(v_type, -1);
  end if;

  if v_jt = 'null' then
    if v_type = 'text' then
      if coalesce(nullif(v_arg1, '')::int, 0) = 0 then
        return jsonb_build_object('v', '');
      end if;
      return jsonb_build_object('e', 'Este campo es obligatorio.');
    end if;
    if v_nullable then
      return jsonb_build_object('v', 'null'::jsonb);
    end if;
  end if;

  case v_type
    when 'text' then
      if v_jt <> 'string' then
        return jsonb_build_object('e', 'Debe ser un texto.');
      end if;
      v_txt := regexp_replace(p_val #>> '{}', '^\s+|\s+$', '', 'g');
      if char_length(v_txt) < v_arg1::int then
        return jsonb_build_object('e', 'Este campo es obligatorio.');
      end if;
      if char_length(v_txt) > v_arg2::int then
        return jsonb_build_object('e', format('Máximo %s caracteres.', v_arg2));
      end if;
      return jsonb_build_object('v', to_jsonb(v_txt));

    when 'amount' then
      if v_jt <> 'number' then
        return jsonb_build_object('e', 'Debe ser un importe en céntimos (número entero).');
      end if;
      v_num := (p_val #>> '{}')::numeric;
      if v_num <> trunc(v_num) then
        return jsonb_build_object('e', 'Debe ser un importe en céntimos (número entero).');
      end if;
      if v_num <= 0 then
        return jsonb_build_object('e', 'El importe debe ser mayor que cero.');
      end if;
      if v_num > 100000000000 then
        return jsonb_build_object('e', 'El importe es demasiado alto.');
      end if;
      return jsonb_build_object('v', to_jsonb(v_num::bigint));

    when 'id' then
      if v_jt <> 'number' then
        return jsonb_build_object('e', 'Identificador no válido.');
      end if;
      v_num := (p_val #>> '{}')::numeric;
      if v_num <> trunc(v_num) or v_num < 1 or v_num > 9223372036854775807 then
        return jsonb_build_object('e', 'Identificador no válido.');
      end if;
      return jsonb_build_object('v', to_jsonb(v_num::bigint));

    when 'bool' then
      if v_jt <> 'boolean' then
        return jsonb_build_object('e', 'Debe ser verdadero o falso.');
      end if;
      return jsonb_build_object('v', p_val);

    when 'date' then
      if v_jt = 'string' and p_val #>> '{}' = '' and v_nullable then
        return jsonb_build_object('v', 'null'::jsonb);
      end if;
      if v_jt <> 'string' or (p_val #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        return jsonb_build_object('e', 'Fecha no válida (AAAA-MM-DD).');
      end if;
      v_txt := p_val #>> '{}';
      v_year := split_part(v_txt, '-', 1)::int;
      v_month := split_part(v_txt, '-', 2)::int;
      v_day := split_part(v_txt, '-', 3)::int;
      if v_year < 1900 or v_year > 2200 then
        return jsonb_build_object('e', 'La fecha está fuera de rango.');
      end if;
      if v_month < 1 or v_month > 12 or v_day < 1 then
        return jsonb_build_object('e', 'Fecha no válida.');
      end if;
      v_last_day := extract(day from (make_date(v_year, v_month, 1) + interval '1 month' - interval '1 day'))::int;
      if v_day > v_last_day then
        return jsonb_build_object('e', 'Fecha no válida.');
      end if;
      return jsonb_build_object('v', to_jsonb(v_txt));

    when 'enum' then
      if v_jt <> 'string' or not ((p_val #>> '{}') = any (string_to_array(v_arg1, '|'))) then
        return jsonb_build_object('e', 'Valor no válido.');
      end if;
      return jsonb_build_object('v', p_val);

    else
      raise exception 'Especificación de campo desconocida: %', p_spec;
  end case;
end
$$;

-- Valida varios campos de un objeto. Devuelve {"values": {...}, "errors": {...}};
-- en «values» solo están los campos presentes y válidos.
create or replace function rumbo.parse_obj(p_obj jsonb, p_specs jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key       text;
  v_spec      text;
  v_required  boolean;
  v_r         jsonb;
  v_values    jsonb := '{}'::jsonb;
  v_errors    jsonb := '{}'::jsonb;
begin
  for v_key, v_spec in select e.key, e.value #>> '{}' from jsonb_each(p_specs) as e loop
    v_required := right(v_spec, 1) = '!';
    if v_required then
      v_spec := left(v_spec, -1);
    end if;
    if p_obj is null or not (p_obj ? v_key) then
      if v_required then
        v_errors := v_errors || jsonb_build_object(v_key, 'Este campo es obligatorio.');
      end if;
      continue;
    end if;
    v_r := rumbo.parse_field(v_spec, p_obj -> v_key);
    if v_r ? 'e' then
      v_errors := v_errors || jsonb_build_object(v_key, v_r -> 'e');
    else
      v_values := v_values || jsonb_build_object(v_key, v_r -> 'v');
    end if;
  end loop;
  return jsonb_build_object('values', v_values, 'errors', v_errors);
end
$$;

-- Compare-and-set por campo. p_payload = {changes, base}. Devuelve
-- {"updates": {...campos a aplicar}, "conflicts": {...}}; los errores de
-- formato se lanzan como «validation».
create or replace function rumbo.cas(p_payload jsonb, p_current jsonb, p_specs jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_changes    jsonb := p_payload -> 'changes';
  v_base       jsonb := p_payload -> 'base';
  v_errors     jsonb := '{}'::jsonb;
  v_parsed     jsonb := '{}'::jsonb;
  v_updates    jsonb := '{}'::jsonb;
  v_conflicts  jsonb := '{}'::jsonb;
  v_key        text;
  v_val        jsonb;
  v_r          jsonb;
  v_cur        jsonb;
  v_seen       jsonb;
begin
  if v_changes is null or jsonb_typeof(v_changes) <> 'object' then
    perform rumbo.require_valid(jsonb_build_object('changes', 'Faltan los cambios.'));
  end if;
  if v_base is not null and jsonb_typeof(v_base) = 'null' then
    v_base := null;
  end if;
  if v_base is not null and jsonb_typeof(v_base) <> 'object' then
    perform rumbo.require_valid(jsonb_build_object('base', 'Formato no válido.'));
  end if;

  for v_key, v_val in select e.key, e.value from jsonb_each(v_changes) as e loop
    if not (p_specs ? v_key) then
      v_errors := v_errors || jsonb_build_object(v_key, 'Este campo no se puede editar.');
      continue;
    end if;
    v_r := rumbo.parse_field(p_specs ->> v_key, v_val);
    if v_r ? 'e' then
      v_errors := v_errors || jsonb_build_object(v_key, v_r -> 'e');
    else
      v_parsed := v_parsed || jsonb_build_object(v_key, v_r -> 'v');
    end if;
  end loop;
  perform rumbo.require_valid(v_errors);

  for v_key, v_val in select e.key, e.value from jsonb_each(v_parsed) as e loop
    v_cur := coalesce(p_current -> v_key, 'null'::jsonb);
    if v_cur = v_val then
      continue;  -- ya tiene ese valor: no es conflicto
    end if;
    if v_base is not null and v_base ? v_key then
      v_r := rumbo.parse_field(p_specs ->> v_key, v_base -> v_key);
      v_seen := coalesce(v_r -> 'v', v_base -> v_key);
      if v_seen is distinct from v_cur then
        v_conflicts := v_conflicts || jsonb_build_object(v_key, 'Cambió en otro dispositivo.');
        continue;
      end if;
    end if;
    v_updates := v_updates || jsonb_build_object(v_key, v_val);
  end loop;

  return jsonb_build_object('updates', v_updates, 'conflicts', v_conflicts);
end
$$;

-- Lista JSON de identificadores enteros (para reordenar).
create or replace function rumbo.parse_id_list(p_val jsonb)
returns bigint[]
language plpgsql
set search_path = ''
as $$
declare
  v_ids  bigint[] := '{}'::bigint[];
  v_el   jsonb;
  v_r    jsonb;
begin
  if p_val is null or jsonb_typeof(p_val) <> 'array' or jsonb_array_length(p_val) > 1000 then
    perform rumbo.require_valid(jsonb_build_object('order', 'El orden debe ser una lista de identificadores.'));
  end if;
  for v_el in select e.val from jsonb_array_elements(p_val) as e(val) loop
    v_r := rumbo.parse_field('id', v_el);
    if v_r ? 'e' then
      perform rumbo.require_valid(jsonb_build_object('order', 'El orden debe ser una lista de identificadores.'));
    end if;
    v_ids := v_ids || (v_r ->> 'v')::bigint;
  end loop;
  return v_ids;
end
$$;

-- Partidas de presupuesto: {"items": [{label, amount_cents}], "errors": {...}}.
create or replace function rumbo.parse_items(p_val jsonb, p_key text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_items   jsonb := '[]'::jsonb;
  v_errors  jsonb := '{}'::jsonb;
  v_el      jsonb;
  v_idx     bigint;
  v_r       jsonb;
  v_key     text;
  v_msg     jsonb;
  v_sum     numeric := 0;
begin
  if p_val is null or jsonb_typeof(p_val) = 'null' then
    return jsonb_build_object('items', v_items, 'errors', v_errors);
  end if;
  if jsonb_typeof(p_val) <> 'array' then
    return jsonb_build_object('items', v_items,
                              'errors', jsonb_build_object(p_key, 'Debe ser una lista de partidas.'));
  end if;
  if jsonb_array_length(p_val) > 50 then
    return jsonb_build_object('items', v_items,
                              'errors', jsonb_build_object(p_key, 'Como máximo 50 partidas.'));
  end if;
  for v_el, v_idx in select e.val, e.idx from jsonb_array_elements(p_val) with ordinality as e(val, idx) loop
    if jsonb_typeof(v_el) <> 'object' then
      v_errors := v_errors || jsonb_build_object(format('%s.%s', p_key, v_idx - 1), 'Partida no válida.');
      continue;
    end if;
    v_r := rumbo.parse_obj(v_el, '{"label": "text:1:80!", "amount_cents": "amount!"}'::jsonb);
    if v_r -> 'errors' <> '{}'::jsonb then
      for v_key, v_msg in select e.key, e.value from jsonb_each(v_r -> 'errors') as e loop
        v_errors := v_errors || jsonb_build_object(format('%s.%s.%s', p_key, v_idx - 1, v_key), v_msg);
      end loop;
      continue;
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'label', v_r -> 'values' ->> 'label',
      'amount_cents', (v_r -> 'values' ->> 'amount_cents')::bigint));
    v_sum := v_sum + (v_r -> 'values' ->> 'amount_cents')::numeric;
  end loop;
  if v_sum > 100000000000 then
    v_errors := v_errors || jsonb_build_object(p_key, 'La suma de las partidas es demasiado alta.');
  end if;
  return jsonb_build_object('items', v_items, 'errors', v_errors);
end
$$;

-- -----------------------------------------------------------------------------
-- Libro de movimientos
-- -----------------------------------------------------------------------------

create or replace function rumbo.goal_label(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_name is null then 'el objetivo' else '«' || p_name || '»' end
$$;

-- «la asignación de 300,00 € a «Moto» del 12/03/2026»
create or replace function rumbo.describe_movement(
  p_kind text, p_amount bigint, p_date date, p_is_initial boolean, p_goal_name text, p_to_goal_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_amount  text := rumbo.fmt_eur(p_amount);
  v_when    text := rumbo.fmt_date(p_date);
  v_goal    text := rumbo.goal_label(p_goal_name);
begin
  return case p_kind
    when 'deposit' then
      case when p_is_initial then 'los ahorros iniciales' else 'el ahorro' end
      || format(' de %s del %s', v_amount, v_when)
    when 'deposit_to_goal' then format('el ahorro de %s para %s del %s', v_amount, v_goal, v_when)
    when 'allocate' then format('la asignación de %s a %s del %s', v_amount, v_goal, v_when)
    when 'release' then format('la liberación de %s de %s del %s', v_amount, v_goal, v_when)
    when 'transfer' then format('el traspaso de %s de %s a %s del %s', v_amount, v_goal,
                                rumbo.goal_label(p_to_goal_name), v_when)
    when 'payment' then format('el pago de %s de %s del %s', v_amount, v_goal, v_when)
    when 'withdrawal' then format('la salida de %s del %s', v_amount, v_when)
    else format('el movimiento de %s del %s', v_amount, v_when)
  end;
end
$$;

-- Reproduce el libro completo del espacio en orden (order_key, id) y exige,
-- tras CADA movimiento, total >= 0, cada reserva >= 0 y disponible >= 0.
-- Devuelve {total_cents, allocated_cents, available_cents, reserves:{goal_id:c},
-- paid:{goal_id:c}} o lanza «ledger_conflict» explicando el primer movimiento
-- que queda imposible.
create or replace function rumbo.replay(p_space_id bigint)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_m          record;
  v_total      bigint := 0;
  v_alloc      bigint := 0;
  v_res        jsonb := '{}'::jsonb;
  v_paid       jsonb := '{}'::jsonb;
  v_g          text;
  v_g2         text;
  v_a          bigint;
  v_reason     text;
  v_problem    bigint;
  v_missing    bigint;
  v_goal_name  text;
  v_to_name    text;
  v_prob_name  text;
  v_tail       text;
begin
  for v_m in
    select mv.id, mv.kind, mv.amount_cents, mv.date, mv.goal_id, mv.to_goal_id, mv.is_initial
      from rumbo.movements mv
     where mv.space_id = p_space_id and mv.status = 'valid'
     order by mv.order_key, mv.id
  loop
    v_a := v_m.amount_cents;
    v_g := v_m.goal_id::text;
    v_g2 := v_m.to_goal_id::text;
    case v_m.kind
      when 'deposit' then
        v_total := v_total + v_a;
      when 'deposit_to_goal' then
        v_total := v_total + v_a;
        v_res := v_res || jsonb_build_object(v_g, coalesce((v_res ->> v_g)::bigint, 0) + v_a);
        v_alloc := v_alloc + v_a;
      when 'allocate' then
        v_res := v_res || jsonb_build_object(v_g, coalesce((v_res ->> v_g)::bigint, 0) + v_a);
        v_alloc := v_alloc + v_a;
      when 'release' then
        v_res := v_res || jsonb_build_object(v_g, coalesce((v_res ->> v_g)::bigint, 0) - v_a);
        v_alloc := v_alloc - v_a;
      when 'transfer' then
        v_res := v_res || jsonb_build_object(v_g, coalesce((v_res ->> v_g)::bigint, 0) - v_a);
        v_res := v_res || jsonb_build_object(v_g2, coalesce((v_res ->> v_g2)::bigint, 0) + v_a);
      when 'payment' then
        v_res := v_res || jsonb_build_object(v_g, coalesce((v_res ->> v_g)::bigint, 0) - v_a);
        v_paid := v_paid || jsonb_build_object(v_g, coalesce((v_paid ->> v_g)::bigint, 0) + v_a);
        v_alloc := v_alloc - v_a;
        v_total := v_total - v_a;
      when 'withdrawal' then
        v_total := v_total - v_a;
    end case;

    v_reason := null;
    if v_g is not null and (v_res ->> v_g)::bigint < 0 then
      v_reason := 'reserve';
      v_problem := v_m.goal_id;
      v_missing := -(v_res ->> v_g)::bigint;
    elsif v_g2 is not null and (v_res ->> v_g2)::bigint < 0 then
      v_reason := 'reserve';
      v_problem := v_m.to_goal_id;
      v_missing := -(v_res ->> v_g2)::bigint;
    elsif v_total - v_alloc < 0 then
      v_reason := 'available';
      v_problem := null;
      v_missing := -(v_total - v_alloc);
    elsif v_total < 0 then
      v_reason := 'total';
      v_problem := null;
      v_missing := -v_total;
    end if;

    if v_reason is not null then
      select g.name into v_goal_name from rumbo.goals g where g.id = v_m.goal_id;
      select g.name into v_to_name from rumbo.goals g where g.id = v_m.to_goal_id;
      select g.name into v_prob_name from rumbo.goals g where g.id = v_problem;
      if v_reason = 'reserve' then
        v_tail := format('superaría lo reservado en %s en %s', rumbo.goal_label(v_prob_name), rumbo.fmt_eur(v_missing));
      elsif v_reason = 'available' then
        v_tail := format('superaría el dinero disponible en %s', rumbo.fmt_eur(v_missing));
      else
        v_tail := format('dejaría los ahorros totales en negativo por %s', rumbo.fmt_eur(v_missing));
      end if;
      perform rumbo.fail(
        'ledger_conflict',
        format('Con este cambio, %s %s. Corrige o anula antes ese movimiento.',
               rumbo.describe_movement(v_m.kind, v_m.amount_cents, v_m.date, v_m.is_initial, v_goal_name, v_to_name),
               v_tail),
        null,
        jsonb_build_object(
          'movement_id', v_m.id,
          'date', to_char(v_m.date, 'YYYY-MM-DD'),
          'kind', v_m.kind,
          'goal_id', v_m.goal_id,
          'goal_name', v_goal_name,
          'to_goal_id', v_m.to_goal_id,
          'to_goal_name', v_to_name,
          'amount_cents', v_m.amount_cents,
          'reason', v_reason,
          'problem_goal_id', v_problem,
          'shortfall_cents', v_missing));
    end if;
  end loop;

  return jsonb_build_object(
    'total_cents', v_total,
    'allocated_cents', v_alloc,
    'available_cents', v_total - v_alloc,
    'reserves', v_res,
    'paid', v_paid);
end
$$;

create or replace function rumbo.savings_json(p_state jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'total_cents', p_state -> 'total_cents',
    'allocated_cents', p_state -> 'allocated_cents',
    'available_cents', p_state -> 'available_cents')
$$;

-- Inserta un movimiento válido. order_key por defecto = su propio id.
create or replace function rumbo.insert_movement(
  p_space_id bigint, p_kind text, p_amount bigint, p_date date, p_attribution text, p_note text,
  p_goal_id bigint, p_to_goal_id bigint, p_is_initial boolean, p_group_id text,
  p_order_key bigint, p_corrects_id bigint)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_id     bigint;
  v_demo   boolean;
  v_count  int;
  v_max    int;
begin
  -- Límite de movimientos por espacio: acota el almacenamiento y el coste del
  -- replay (que recorre el libro completo en cada operación con dinero).
  select s.is_demo into v_demo from rumbo.spaces s where s.id = p_space_id;
  v_max := case when coalesce(v_demo, false) then 1000 else 5000 end;
  select count(*)::int into v_count from rumbo.movements mv where mv.space_id = p_space_id;
  if v_count >= v_max then
    perform rumbo.fail('limit_reached',
      format('Este espacio ya tiene el máximo de movimientos permitidos (%s).', v_max),
      null, jsonb_build_object('max_movements', v_max));
  end if;
  insert into rumbo.movements (space_id, kind, amount_cents, date, attribution, note, goal_id, to_goal_id,
                              is_initial, group_id, status, order_key, corrects_id)
  values (p_space_id, p_kind, p_amount, p_date, p_attribution, coalesce(p_note, ''), p_goal_id, p_to_goal_id,
          coalesce(p_is_initial, false), p_group_id, 'valid', 0, p_corrects_id)
  returning id into v_id;
  update rumbo.movements mv set order_key = coalesce(p_order_key, v_id) where mv.id = v_id;
  return v_id;
end
$$;

-- -----------------------------------------------------------------------------
-- Serialización (forma idéntica a la API v1)
-- -----------------------------------------------------------------------------

create or replace function rumbo.space_json(p_space_id bigint)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  return (
    select jsonb_build_object(
      'id', s.id, 'name_a', s.name_a, 'name_b', s.name_b, 'is_demo', s.is_demo,
      'created_at', rumbo.ts(s.created_at))
    from rumbo.spaces s where s.id = p_space_id);
end
$$;

create or replace function rumbo.tabs_json(p_space_id bigint)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', t.id, 'name', t.name, 'position', t.position,
             'goal_count', (select count(*) from rumbo.goals g where g.tab_id = t.id),
             'created_at', rumbo.ts(t.created_at), 'updated_at', rumbo.ts(t.updated_at))
           order by t.position, t.id), '[]'::jsonb)
    from rumbo.tabs t where t.space_id = p_space_id);
end
$$;

create or replace function rumbo.tab_json(p_tab_id bigint)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  return (
    select jsonb_build_object(
             'id', t.id, 'name', t.name, 'position', t.position,
             'goal_count', (select count(*) from rumbo.goals g where g.tab_id = t.id),
             'created_at', rumbo.ts(t.created_at), 'updated_at', rumbo.ts(t.updated_at))
    from rumbo.tabs t where t.id = p_tab_id);
end
$$;

create or replace function rumbo.task_json(p_task_id bigint)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  return (
    select jsonb_build_object(
             'id', t.id, 'goal_id', t.goal_id, 'title', t.title, 'done', t.done,
             'assignee', t.assignee, 'due_date', to_char(t.due_date, 'YYYY-MM-DD'), 'note', t.note,
             'position', t.position, 'created_at', rumbo.ts(t.created_at),
             'updated_at', rumbo.ts(t.updated_at), 'completed_at', rumbo.ts(t.completed_at))
    from rumbo.tasks t where t.id = p_task_id);
end
$$;

create or replace function rumbo.tasks_json(p_goal_id bigint)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  return (
    select coalesce(jsonb_agg(rumbo.task_json(t.id) order by t.position, t.id), '[]'::jsonb)
    from rumbo.tasks t where t.goal_id = p_goal_id);
end
$$;

-- Movimientos del espacio (todos, o los de p_ids), más recientes primero.
create or replace function rumbo.movements_json(p_space_id bigint, p_ids bigint[] default null)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', mv.id, 'kind', mv.kind, 'amount_cents', mv.amount_cents,
             'date', to_char(mv.date, 'YYYY-MM-DD'), 'attribution', mv.attribution, 'note', mv.note,
             'goal_id', mv.goal_id, 'to_goal_id', mv.to_goal_id, 'is_initial', mv.is_initial,
             'group_id', mv.group_id, 'status', mv.status, 'order_key', mv.order_key,
             'corrects_id', mv.corrects_id, 'replaced_by_id', mv.replaced_by_id,
             'void_reason', mv.void_reason, 'voided_at', rumbo.ts(mv.voided_at),
             'created_at', rumbo.ts(mv.created_at),
             'goal_name', g1.name, 'to_goal_name', g2.name)
           order by mv.id desc), '[]'::jsonb)
    from rumbo.movements mv
    left join rumbo.goals g1 on g1.id = mv.goal_id
    left join rumbo.goals g2 on g2.id = mv.to_goal_id
    where mv.space_id = p_space_id
      and (p_ids is null or mv.id = any (p_ids)));
end
$$;

-- Objetivo con partidas, tareas y bloque «computed» (§4).
create or replace function rumbo.goal_json(p_goal_id bigint, p_state jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_g            rumbo.goals%rowtype;
  v_items        jsonb;
  v_items_sum    bigint;
  v_items_count  int;
  v_tasks        jsonb;
  v_tasks_total  int;
  v_tasks_done   int;
  v_tasks_last   timestamptz;
  v_has_mov      boolean;
  v_mov_last     timestamptz;
  v_target       bigint;
  v_reserved     bigint;
  v_paid         bigint;
  v_covered      bigint;
  v_percent      float8;
  v_funding      text;
  v_last         timestamptz;
begin
  select * into v_g from rumbo.goals g where g.id = p_goal_id;
  if not found then
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id, 'label', b.label, 'amount_cents', b.amount_cents, 'position', b.position)
         order by b.position, b.id), '[]'::jsonb),
         coalesce(sum(b.amount_cents), 0)::bigint,
         count(*)::int
    into v_items, v_items_sum, v_items_count
    from rumbo.budget_items b where b.goal_id = p_goal_id;

  select count(*)::int, (count(*) filter (where t.done))::int, max(t.updated_at)
    into v_tasks_total, v_tasks_done, v_tasks_last
    from rumbo.tasks t where t.goal_id = p_goal_id;
  v_tasks := rumbo.tasks_json(p_goal_id);

  select count(*) > 0, max(mv.created_at)
    into v_has_mov, v_mov_last
    from rumbo.movements mv
   where mv.space_id = v_g.space_id and (mv.goal_id = p_goal_id or mv.to_goal_id = p_goal_id);

  v_target := case when v_items_count > 0 then v_items_sum else v_g.target_cents end;
  v_reserved := coalesce((p_state -> 'reserves' ->> p_goal_id::text)::bigint, 0);
  v_paid := coalesce((p_state -> 'paid' ->> p_goal_id::text)::bigint, 0);
  v_covered := v_reserved + v_paid;
  v_percent := case when v_target > 0 then (v_covered::float8 * 100) / v_target::float8 else 0 end;
  v_funding := case when v_covered = 0 then 'none' when v_covered < v_target then 'progress' else 'funded' end;
  v_last := greatest(v_g.updated_at, v_g.last_activity_at, v_tasks_last, v_mov_last);

  return jsonb_build_object(
    'id', v_g.id, 'tab_id', v_g.tab_id, 'name', v_g.name, 'description', v_g.description,
    'target_cents', v_g.target_cents, 'beneficiary', v_g.beneficiary, 'priority', v_g.priority,
    'desired_date', to_char(v_g.desired_date, 'YYYY-MM-DD'), 'notes', v_g.notes, 'status', v_g.status,
    'created_at', rumbo.ts(v_g.created_at), 'updated_at', rumbo.ts(v_g.updated_at),
    'last_activity_at', rumbo.ts(v_last), 'status_changed_at', rumbo.ts(v_g.status_changed_at),
    'budget_items', v_items,
    'tasks', v_tasks,
    'computed', jsonb_build_object(
      'target_cents', v_target,
      'reserved_cents', v_reserved,
      'paid_cents', v_paid,
      'covered_cents', v_covered,
      'pending_cents', greatest(0, v_target - v_covered),
      'surplus_cents', greatest(0, v_covered - v_target),
      'percent', v_percent,
      'percent_capped', least(100::float8, v_percent),
      'funding_status', v_funding,
      'tasks_total', v_tasks_total,
      'tasks_done', v_tasks_done,
      'tasks_percent', case when v_tasks_total > 0
                            then (v_tasks_done::float8 * 100) / v_tasks_total::float8 end,
      'ready_to_complete', v_g.status in ('active', 'paused') and v_funding = 'funded'
                           and (v_tasks_total = 0 or v_tasks_done = v_tasks_total),
      'last_activity_at', rumbo.ts(v_last),
      'has_movements', v_has_mov));
end
$$;

create or replace function rumbo.goal_current(p_goal_id bigint)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  return rumbo.goal_json(p_goal_id, rumbo.replay((select g.space_id from rumbo.goals g where g.id = p_goal_id)));
end
$$;

-- Estado completo del espacio (forma de GET /api/state en v1).
create or replace function rumbo.state_json(p_space_id bigint)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_state    jsonb;
  v_goals    jsonb;
  v_summary  jsonb;
  v_rev      bigint;
begin
  v_state := rumbo.replay(p_space_id);
  select coalesce(jsonb_agg(rumbo.goal_json(g.id, v_state) order by g.id), '[]'::jsonb)
    into v_goals
    from rumbo.goals g where g.space_id = p_space_id;

  select jsonb_build_object(
           'active_count', count(*),
           'active_target_cents', coalesce(sum(q.target), 0)::bigint,
           'active_covered_capped_cents', coalesce(sum(least(q.covered, q.target)), 0)::bigint,
           'active_pending_cents', coalesce(sum(q.pending), 0)::bigint,
           'active_percent', case when count(*) > 0 and sum(q.target) > 0
                                  then (sum(least(q.covered, q.target))::float8 * 100) / sum(q.target)::float8 end)
    into v_summary
    from (select (x.val -> 'computed' ->> 'target_cents')::bigint as target,
                 (x.val -> 'computed' ->> 'covered_cents')::bigint as covered,
                 (x.val -> 'computed' ->> 'pending_cents')::bigint as pending
            from jsonb_array_elements(v_goals) as x(val)
           where x.val ->> 'status' = 'active') q;

  select s.rev into v_rev from rumbo.spaces s where s.id = p_space_id;

  return jsonb_build_object(
    'rev', v_rev,
    'space', rumbo.space_json(p_space_id),
    'tabs', rumbo.tabs_json(p_space_id),
    'goals', v_goals,
    'savings', rumbo.savings_json(v_state),
    'summary', v_summary,
    'movements', rumbo.movements_json(p_space_id, null));
end
$$;

-- -----------------------------------------------------------------------------
-- Acceso
-- -----------------------------------------------------------------------------

-- Una demo caduca a las 24 h: desde entonces su enlace deja de funcionar
-- aunque la fila aún no se haya purgado.
create or replace function rumbo.demo_expired(p_is_demo boolean, p_created_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(p_is_demo, false) and p_created_at < now() - interval '24 hours'
$$;

create or replace function rumbo.space_id_by_secret(p_secret text)
returns bigint
language plpgsql
stable
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if not rumbo.valid_secret(p_secret) then
    perform rumbo.fail('unauthorized', 'Este enlace no es válido o ha sido regenerado.');
  end if;
  select s.id into v_id from rumbo.spaces s
   where s.token_hash = rumbo.secret_hash(p_secret) and not rumbo.demo_expired(s.is_demo, s.created_at);
  if not found then
    perform rumbo.fail('unauthorized', 'Este enlace no es válido o ha sido regenerado.');
  end if;
  return v_id;
end
$$;

-- -----------------------------------------------------------------------------
-- Acciones (todas reciben el id del espacio ya autenticado y bloqueado)
-- -----------------------------------------------------------------------------

create or replace function rumbo.conflict_message()
returns text
language sql
immutable
set search_path = ''
as $$
  select 'Este dato cambió en otro dispositivo. Hemos cargado la versión actual; revisa y vuelve a guardar.'::text
$$;

-- --- Espacio ---------------------------------------------------------------

create or replace function rumbo.a_set_names(p_space_id bigint, p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_cur  jsonb;
  v_cas  jsonb;
  v_upd  jsonb;
begin
  select jsonb_build_object('name_a', s.name_a, 'name_b', s.name_b)
    into v_cur from rumbo.spaces s where s.id = p_space_id;
  v_cas := rumbo.cas(p, v_cur, '{"name_a": "text:0:40", "name_b": "text:0:40"}'::jsonb);
  if v_cas -> 'conflicts' <> '{}'::jsonb then
    perform rumbo.fail('conflict', rumbo.conflict_message(), v_cas -> 'conflicts', null, rumbo.space_json(p_space_id));
  end if;
  v_upd := v_cas -> 'updates';
  if v_upd <> '{}'::jsonb then
    update rumbo.spaces s set
      name_a = case when v_upd ? 'name_a' then v_upd ->> 'name_a' else s.name_a end,
      name_b = case when v_upd ? 'name_b' then v_upd ->> 'name_b' else s.name_b end
    where s.id = p_space_id;
  end if;
  return jsonb_build_object('space', rumbo.space_json(p_space_id));
end
$$;

create or replace function rumbo.a_regenerate_link(p_space_id bigint, p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_secret  jsonb := p -> 'new_secret';
  v_hash    text;
begin
  if v_secret is null or jsonb_typeof(v_secret) <> 'string' or not rumbo.valid_secret(v_secret #>> '{}') then
    perform rumbo.require_valid(jsonb_build_object('new_secret', 'El nuevo enlace no es válido.'));
  end if;
  v_hash := rumbo.secret_hash(v_secret #>> '{}');
  if exists (select 1 from rumbo.spaces s where s.token_hash = v_hash) then
    perform rumbo.require_valid(jsonb_build_object('new_secret', 'Ese enlace ya está en uso. Genera otro.'));
  end if;
  update rumbo.spaces s set token_hash = v_hash where s.id = p_space_id;
  return jsonb_build_object('ok', true);
end
$$;

-- --- Pestañas --------------------------------------------------------------

create or replace function rumbo.tab_name_taken(p_space_id bigint, p_name text, p_exclude bigint)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  return exists (
    select 1 from rumbo.tabs t
     where t.space_id = p_space_id and lower(t.name) = lower(p_name)
       and (p_exclude is null or t.id <> p_exclude));
end
$$;

create or replace function rumbo.a_create_tab(p_space_id bigint, p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_r     jsonb := rumbo.parse_obj(p, '{"name": "text:1:40!"}'::jsonb);
  v_name  text;
  v_count int;
  v_max   int;
  v_id    bigint;
begin
  perform rumbo.require_valid(v_r -> 'errors');
  v_name := v_r -> 'values' ->> 'name';
  if rumbo.tab_name_taken(p_space_id, v_name, null) then
    perform rumbo.require_valid(jsonb_build_object('name', 'Ya existe una pestaña con ese nombre.'));
  end if;
  select count(*)::int, coalesce(max(t.position), -1) into v_count, v_max
    from rumbo.tabs t where t.space_id = p_space_id;
  if v_count >= 50 then
    perform rumbo.require_valid(jsonb_build_object('name', 'Como máximo puede haber 50 pestañas.'));
  end if;
  insert into rumbo.tabs (space_id, name, position) values (p_space_id, v_name, v_max + 1)
  returning id into v_id;
  return jsonb_build_object('tab', rumbo.tab_json(v_id));
end
$$;

create or replace function rumbo.a_rename_tab(p_space_id bigint, p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_r    jsonb := rumbo.parse_obj(p, '{"id": "id!"}'::jsonb);
  v_id   bigint;
  v_cur  jsonb;
  v_cas  jsonb;
  v_upd  jsonb;
begin
  perform rumbo.require_valid(v_r -> 'errors');
  v_id := (v_r -> 'values' ->> 'id')::bigint;
  select jsonb_build_object('name', t.name) into v_cur
    from rumbo.tabs t where t.id = v_id and t.space_id = p_space_id;
  if not found then
    perform rumbo.fail('not_found', 'Esta pestaña ya no existe.');
  end if;
  v_cas := rumbo.cas(p, v_cur, '{"name": "text:1:40"}'::jsonb);
  if v_cas -> 'conflicts' <> '{}'::jsonb then
    perform rumbo.fail('conflict', rumbo.conflict_message(), v_cas -> 'conflicts', null, rumbo.tab_json(v_id));
  end if;
  v_upd := v_cas -> 'updates';
  if v_upd ? 'name' then
    if rumbo.tab_name_taken(p_space_id, v_upd ->> 'name', v_id) then
      perform rumbo.require_valid(jsonb_build_object('name', 'Ya existe una pestaña con ese nombre.'));
    end if;
    update rumbo.tabs t set name = v_upd ->> 'name', updated_at = now() where t.id = v_id;
  end if;
  return jsonb_build_object('tab', rumbo.tab_json(v_id));
end
$$;

create or replace function rumbo.a_reorder_tabs(p_space_id bigint, p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_order    bigint[] := rumbo.parse_id_list(p -> 'order');
  v_current  bigint[];
begin
  select coalesce(array_agg(t.id order by t.id), '{}'::bigint[]) into v_current
    from rumbo.tabs t where t.space_id = p_space_id;
  if cardinality(v_order) <> (select count(distinct u.x) from unnest(v_order) as u(x))
     or (select coalesce(array_agg(u.x order by u.x), '{}'::bigint[]) from unnest(v_order) as u(x)) <> v_current then
    perform rumbo.fail('conflict', rumbo.conflict_message(), null, null,
                      jsonb_build_object('tabs', rumbo.tabs_json(p_space_id)));
  end if;
  update rumbo.tabs t set position = (o.idx - 1)::int, updated_at = now()
    from unnest(v_order) with ordinality as o(tab_id, idx)
   where t.id = o.tab_id and t.space_id = p_space_id;
  return jsonb_build_object('tabs', rumbo.tabs_json(p_space_id));
end
$$;

create or replace function rumbo.a_delete_tab(p_space_id bigint, p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_r        jsonb := rumbo.parse_obj(p, '{"id": "id!", "move_to_tab_id": "id?"}'::jsonb);
  v_id       bigint;
  v_move_to  bigint;
  v_count    int;
  v_moved    int := 0;
begin
  perform rumbo.require_valid(v_r -> 'errors');
  v_id := (v_r -> 'values' ->> 'id')::bigint;
  v_move_to := (v_r -> 'values' ->> 'move_to_tab_id')::bigint;
  perform 1 from rumbo.tabs t where t.id = v_id and t.space_id = p_space_id;
  if not found then
    perform rumbo.fail('not_found', 'Esta pestaña ya no existe.');
  end if;
  if v_move_to is not null
     and (v_move_to = v_id
          or not exists (select 1 from rumbo.tabs t where t.id = v_move_to and t.space_id = p_space_id)) then
    perform rumbo.require_valid(jsonb_build_object('move_to_tab_id', 'Elige otra pestaña existente como destino.'));
  end if;
  select count(*)::int into v_count from rumbo.goals g where g.tab_id = v_id;
  if v_count > 0 then
    if v_move_to is null then
      perform rumbo.fail('tab_has_goals',
                        'Esta pestaña tiene objetivos. Elige a qué pestaña moverlos antes de eliminarla.',
                        null, jsonb_build_object('goal_count', v_count));
    end if;
    update rumbo.goals g set tab_id = v_move_to, updated_at = now() where g.tab_id = v_id;
    get diagnostics v_moved = row_count;
  end if;
  delete from rumbo.tabs t where t.id = v_id;
  update rumbo.tabs t set position = (q.rn - 1)::int
    from (select t2.id, row_number() over (order by t2.position, t2.id) as rn
            from rumbo.tabs t2 where t2.space_id = p_space_id) q
   where t.id = q.id;
  return jsonb_build_object('deleted_tab_id', v_id, 'moved_goal_count', v_moved,
                            'tabs', rumbo.tabs_json(p_space_id));
end
$$;

-- --- Objetivos -------------------------------------------------------------

create or replace function rumbo.a_create_goal(p_space_id bigint, p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_r       jsonb := rumbo.parse_obj(p, '{
                 "tab_id": "id!", "name": "text:1:80!",
                 "beneficiary": "enum:both|a|b", "priority": "enum:high|medium|low",
                 "description": "text:0:200", "desired_date": "date?", "notes": "text:0:2000",
                 "target_cents": "amount?"}'::jsonb);
  v_vals    jsonb := v_r -> 'values';
  v_errors  jsonb := v_r -> 'errors';
  v_items   jsonb;
  v_tasks   jsonb := '[]'::jsonb;
  v_task    jsonb;
  v_idx     bigint;
  v_tr      jsonb;
  v_target  bigint;
  v_count   int;
  v_id      bigint;
begin
  v_items := rumbo.parse_items(p -> 'budget_items', 'budget_items');
  v_errors := v_errors || (v_items -> 'errors');
  v_items := v_items -> 'items';

  v_target := (v_vals ->> 'target_cents')::bigint;
  if v_target is null and jsonb_array_length(v_items) = 0 and not (v_errors ? 'target_cents')
     and not (v_errors ? 'budget_items') then
    v_errors := v_errors || jsonb_build_object('target_cents', 'Indica la meta o un desglose del presupuesto.');
  end if;

  if p ? 'tasks' and jsonb_typeof(p -> 'tasks') <> 'null' then
    if jsonb_typeof(p -> 'tasks') <> 'array' or jsonb_array_length(p -> 'tasks') > 200 then
      v_errors := v_errors || jsonb_build_object('tasks', 'Lista de pasos no válida.');
    else
      for v_task, v_idx in select e.val, e.idx from jsonb_array_elements(p -> 'tasks') with ordinality as e(val, idx) loop
        if jsonb_typeof(v_task) <> 'object' then
          v_errors := v_errors || jsonb_build_object(format('tasks.%s', v_idx - 1), 'Paso no válido.');
          continue;
        end if;
        v_tr := rumbo.parse_field('text:1:120', coalesce(v_task -> 'title', 'null'::jsonb));
        if v_tr ? 'e' then
          v_errors := v_errors || jsonb_build_object(format('tasks.%s.title', v_idx - 1), v_tr -> 'e');
        else
          v_tasks := v_tasks || jsonb_build_array(v_tr -> 'v');
        end if;
      end loop;
    end if;
  end if;

  if v_vals ? 'tab_id' and not exists (
       select 1 from rumbo.tabs t where t.id = (v_vals ->> 'tab_id')::bigint and t.space_id = p_space_id) then
    v_errors := v_errors || jsonb_build_object('tab_id', 'La pestaña no existe.');
  end if;
  perform rumbo.require_valid(v_errors);

  select count(*)::int into v_count from rumbo.goals g where g.space_id = p_space_id;
  if v_count >= 500 then
    perform rumbo.require_valid(jsonb_build_object('name', 'Como máximo puede haber 500 objetivos.'));
  end if;
  if jsonb_array_length(v_tasks) > 0 and (select count(*) from rumbo.tasks t join rumbo.goals g on g.id = t.goal_id
       where g.space_id = p_space_id) + jsonb_array_length(v_tasks) > 5000 then
    perform rumbo.require_valid(jsonb_build_object('tasks', 'Como máximo puede haber 5000 tareas en el espacio.'));
  end if;

  if jsonb_array_length(v_items) > 0 then
    -- Con partidas, la meta es su suma (la meta manual se ignora).
    select sum((e.val ->> 'amount_cents')::bigint)::bigint into v_target
      from jsonb_array_elements(v_items) as e(val);
  end if;

  insert into rumbo.goals (space_id, tab_id, name, description, target_cents, beneficiary, priority,
                          desired_date, notes)
  values (p_space_id, (v_vals ->> 'tab_id')::bigint, v_vals ->> 'name',
          coalesce(v_vals ->> 'description', ''), v_target,
          coalesce(v_vals ->> 'beneficiary', 'both'), coalesce(v_vals ->> 'priority', 'medium'),
          (v_vals ->> 'desired_date')::date, coalesce(v_vals ->> 'notes', ''))
  returning id into v_id;

  insert into rumbo.budget_items (goal_id, label, amount_cents, position)
  select v_id, e.val ->> 'label', (e.val ->> 'amount_cents')::bigint, (e.idx - 1)::int
    from jsonb_array_elements(v_items) with ordinality as e(val, idx);

  insert into rumbo.tasks (goal_id, title, position)
  select v_id, e.val #>> '{}', (e.idx - 1)::int
    from jsonb_array_elements(v_tasks) with ordinality as e(val, idx);

  return jsonb_build_object('goal', rumbo.goal_current(v_id));
end
$$;

create or replace function rumbo.a_update_goal(p_space_id bigint, p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_r        jsonb := rumbo.parse_obj(p, '{"id": "id!", "release_reserve": "bool"}'::jsonb);
  v_id       bigint;
  v_release  boolean;
  v_cur      jsonb;
  v_cas      jsonb;
  v_upd      jsonb;
  v_state    jsonb;
  v_reserved bigint;
  v_status   text;
  v_created  bigint[] := '{}'::bigint[];
begin
  perform rumbo.require_valid(v_r -> 'errors');
  v_id := (v_r -> 'values' ->> 'id')::bigint;
  v_release :=coalesce((v_r -> 'values' ->> 'release_reserve')::boolean, false);

  select jsonb_build_object(
           'name', g.name, 'description', g.description, 'target_cents', g.target_cents,
           'beneficiary', g.beneficiary, 'priority', g.priority,
           'desired_date', to_char(g.desired_date, 'YYYY-MM-DD'), 'notes', g.notes,
           'tab_id', g.tab_id, 'status', g.status)
    into v_cur
    from rumbo.goals g where g.id = v_id and g.space_id = p_space_id;
  if not found then
    perform rumbo.fail('not_found', 'Este objetivo ya no existe.');
  end if;

  v_cas := rumbo.cas(p, v_cur, '{
      "name": "text:1:80", "description": "text:0:200", "target_cents": "amount",
      "beneficiary": "enum:both|a|b", "priority": "enum:high|medium|low",
      "desired_date": "date?", "notes": "text:0:2000", "tab_id": "id",
      "status": "enum:active|paused|done|archived"}'::jsonb);
  if v_cas -> 'conflicts' <> '{}'::jsonb then
    perform rumbo.fail('conflict', rumbo.conflict_message(), v_cas -> 'conflicts', null, rumbo.goal_current(v_id));
  end if;
  v_upd := v_cas -> 'updates';

  if v_upd ? 'tab_id' and not exists (
       select 1 from rumbo.tabs t where t.id = (v_upd ->> 'tab_id')::bigint and t.space_id = p_space_id) then
    perform rumbo.require_valid(jsonb_build_object('tab_id', 'La pestaña no existe.'));
  end if;
  -- Con desglose, la meta es siempre la suma de las partidas.
  if v_upd ? 'target_cents' and exists (select 1 from rumbo.budget_items b where b.goal_id = v_id) then
    perform rumbo.require_valid(jsonb_build_object('target_cents',
      'La meta es la suma del desglose; cámbiala con «Editar desglose».'));
  end if;

  if v_upd <> '{}'::jsonb then
    update rumbo.goals g set
      name = case when v_upd ? 'name' then v_upd ->> 'name' else g.name end,
      description = case when v_upd ? 'description' then v_upd ->> 'description' else g.description end,
      target_cents = case when v_upd ? 'target_cents' then (v_upd ->> 'target_cents')::bigint else g.target_cents end,
      beneficiary = case when v_upd ? 'beneficiary' then v_upd ->> 'beneficiary' else g.beneficiary end,
      priority = case when v_upd ? 'priority' then v_upd ->> 'priority' else g.priority end,
      desired_date = case when v_upd ? 'desired_date' then (v_upd ->> 'desired_date')::date else g.desired_date end,
      notes = case when v_upd ? 'notes' then v_upd ->> 'notes' else g.notes end,
      tab_id = case when v_upd ? 'tab_id' then (v_upd ->> 'tab_id')::bigint else g.tab_id end,
      status = case when v_upd ? 'status' then v_upd ->> 'status' else g.status end,
      status_changed_at = case when v_upd ? 'status' then now() else g.status_changed_at end,
      updated_at = now(),
      last_activity_at = now()
    where g.id = v_id;
  end if;

  -- Devolución de la reserva: se decide por el estado resultante, no por si el
  -- estado cambió en esta llamada. Si otro dispositivo ya archivó o cumplió el
  -- objetivo manteniendo la reserva, «Devolver al disponible» sigue liberándola.
  v_status := p -> 'changes' ->> 'status';
  if v_release and v_status in ('done', 'archived')
     and exists (select 1 from rumbo.goals g where g.id = v_id and g.status = v_status) then
    v_state := rumbo.replay(p_space_id);
    v_reserved := coalesce((v_state -> 'reserves' ->> v_id::text)::bigint, 0);
    if v_reserved > 0 then
      v_created := v_created || rumbo.insert_movement(
        p_space_id, 'release', v_reserved, rumbo.today(), null,
        case when v_status = 'done'
             then 'Reserva devuelta al disponible al marcar como cumplido'
             else 'Reserva devuelta al disponible al archivar' end,
        v_id, null, false, null, null, null);
    end if;
  end if;

  v_state := rumbo.replay(p_space_id);
  return jsonb_build_object(
    'goal', rumbo.goal_json(v_id, v_state),
    'movements', rumbo.movements_json(p_space_id, v_created),
    'savings', rumbo.savings_json(v_state));
end
$$;

create or replace function rumbo.a_set_budget(p_space_id bigint, p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_r        jsonb := rumbo.parse_obj(p, '{"goal_id": "id!", "target_cents": "amount?",
                                                  "base_target_cents": "amount?"}'::jsonb);
  v_id       bigint;
  v_errors   jsonb := v_r -> 'errors';
  v_items    jsonb;
  v_manual   bigint;
  v_current  jsonb;
  v_cur_sum  bigint;
  v_base     jsonb;
  v_base_raw jsonb := p -> 'base_items';
  v_el       jsonb;
  v_target   bigint;
  v_cur_tgt  bigint;
  v_base_tgt bigint;
begin
  if p -> 'items' is null or jsonb_typeof(p -> 'items') <> 'array' then
    v_errors := v_errors || jsonb_build_object('items', 'Debe ser una lista de partidas.');
  else
    v_items := rumbo.parse_items(p -> 'items', 'items');
    v_errors := v_errors || (v_items -> 'errors');
    v_items := v_items -> 'items';
  end if;
  perform rumbo.require_valid(v_errors);
  v_id := (v_r -> 'values' ->> 'goal_id')::bigint;
  v_manual := (v_r -> 'values' ->> 'target_cents')::bigint;

  v_base_tgt := (v_r -> 'values' ->> 'base_target_cents')::bigint;

  select g.target_cents into v_cur_tgt from rumbo.goals g where g.id = v_id and g.space_id = p_space_id;
  if not found then
    perform rumbo.fail('not_found', 'Este objetivo ya no existe.');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('label', b.label, 'amount_cents', b.amount_cents)
                            order by b.position, b.id), '[]'::jsonb),
         coalesce(sum(b.amount_cents), 0)::bigint
    into v_current, v_cur_sum
    from rumbo.budget_items b where b.goal_id = v_id;

  if v_base_raw is not null and jsonb_typeof(v_base_raw) <> 'null' and v_current <> v_items then
    v_base := '[]'::jsonb;
    if jsonb_typeof(v_base_raw) = 'array' then
      for v_el in select e.val from jsonb_array_elements(v_base_raw) as e(val) loop
        if jsonb_typeof(v_el) = 'object' then
          v_base := v_base || jsonb_build_array(jsonb_build_object(
            'label', coalesce(rumbo.parse_field('text:0:1000', coalesce(v_el -> 'label', 'null'::jsonb)) -> 'v',
                              v_el -> 'label'),
            'amount_cents', v_el -> 'amount_cents'));
        else
          v_base := v_base || jsonb_build_array(v_el);
        end if;
      end loop;
    else
      v_base := v_base_raw;
    end if;
    if v_base <> v_current then
      perform rumbo.fail('conflict', rumbo.conflict_message(),
                        jsonb_build_object('items', 'Cambió en otro dispositivo.'), null, rumbo.goal_current(v_id));
    end if;
  end if;

  if jsonb_array_length(v_items) > 0 then
    select sum((e.val ->> 'amount_cents')::bigint)::bigint into v_target
      from jsonb_array_elements(v_items) as e(val);
  elsif jsonb_array_length(v_current) = 0 then
    -- Sin partidas antes ni después: la meta manual solo cambia con
    -- compare-and-set (base_target_cents). Sin base no se toca: el formulario
    -- de desglose puede llevar una meta manual oculta y desfasada.
    if v_manual is not null and v_manual <> v_cur_tgt and v_base_tgt is not null then
      if v_base_tgt <> v_cur_tgt then
        perform rumbo.fail('conflict', rumbo.conflict_message(),
                          jsonb_build_object('target_cents', 'Cambió en otro dispositivo.'), null,
                          rumbo.goal_current(v_id));
      end if;
      v_target := v_manual;
    end if;
  elsif v_manual is not null then
    v_target := v_manual;
  elsif v_cur_sum > 0 then
    v_target := v_cur_sum;  -- vuelta a meta manual: por defecto, la suma anterior
  end if;

  delete from rumbo.budget_items b where b.goal_id = v_id;
  insert into rumbo.budget_items (goal_id, label, amount_cents, position)
  select v_id, e.val ->> 'label', (e.val ->> 'amount_cents')::bigint, (e.idx - 1)::int
    from jsonb_array_elements(v_items) with ordinality as e(val, idx);
  update rumbo.goals g set
    target_cents = coalesce(v_target, g.target_cents),
    updated_at = now(),
    last_activity_at = now()
  where g.id = v_id;

  return jsonb_build_object('goal', rumbo.goal_current(v_id));
end
$$;

create or replace function rumbo.a_delete_goal(p_space_id bigint, p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_r      jsonb := rumbo.parse_obj(p, '{"id": "id!"}'::jsonb);
  v_id     bigint;
  v_count  int;
begin
  perform rumbo.require_valid(v_r -> 'errors');
  v_id := (v_r -> 'values' ->> 'id')::bigint;
  perform 1 from rumbo.goals g where g.id = v_id and g.space_id = p_space_id;
  if not found then
    perform rumbo.fail('not_found', 'Este objetivo ya no existe.');
  end if;
  select count(*)::int into v_count from rumbo.movements mv
   where mv.space_id = p_space_id and (mv.goal_id = v_id or mv.to_goal_id = v_id);
  if v_count > 0 then
    perform rumbo.fail('goal_has_movements',
                      'Este objetivo tiene movimientos de dinero y no se puede eliminar. Puedes archivarlo.',
                      null, jsonb_build_object('movement_count', v_count));
  end if;
  delete from rumbo.goals g where g.id = v_id;  -- partidas y tareas en cascada
  return jsonb_build_object('deleted_goal_id', v_id);
end
$$;

-- --- Tareas ----------------------------------------------------------------

create or replace function rumbo.a_create_task(p_space_id bigint, p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_r      jsonb := rumbo.parse_obj(p, '{
               "goal_id": "id!", "title": "text:1:120!", "assignee": "enum?:a|b|both",
               "due_date": "date?", "note": "text:0:500"}'::jsonb);
  v_vals   jsonb := v_r -> 'values';
  v_goal   bigint;
  v_count  int;
  v_max    int;
  v_id     bigint;
begin
  perform rumbo.require_valid(v_r -> 'errors');
  v_goal := (v_vals ->> 'goal_id')::bigint;
  perform 1 from rumbo.goals g where g.id = v_goal and g.space_id = p_space_id;
  if not found then
    perform rumbo.fail('not_found', 'Este objetivo ya no existe.');
  end if;
  select count(*)::int, coalesce(max(t.position), -1) into v_count, v_max
    from rumbo.tasks t where t.goal_id = v_goal;
  if v_count >= 200 then
    perform rumbo.require_valid(jsonb_build_object('title', 'Como máximo 200 tareas por objetivo.'));
  end if;
  if (select count(*) from rumbo.tasks t join rumbo.goals g on g.id = t.goal_id
       where g.space_id = p_space_id) >= 5000 then
    perform rumbo.require_valid(jsonb_build_object('title', 'Como máximo puede haber 5000 tareas en el espacio.'));
  end if;
  insert into rumbo.tasks (goal_id, title, assignee, due_date, note, position)
  values (v_goal, v_vals ->> 'title', v_vals ->> 'assignee', (v_vals ->> 'due_date')::date,
          coalesce(v_vals ->> 'note', ''), v_max + 1)
  returning id into v_id;
  update rumbo.goals g set last_activity_at = now() where g.id = v_goal;
  return jsonb_build_object('task', rumbo.task_json(v_id));
end
$$;

create or replace function rumbo.a_update_task(p_space_id bigint, p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_r     jsonb := rumbo.parse_obj(p, '{"id": "id!"}'::jsonb);
  v_id    bigint;
  v_goal  bigint;
  v_cur   jsonb;
  v_cas   jsonb;
  v_upd   jsonb;
begin
  perform rumbo.require_valid(v_r -> 'errors');
  v_id := (v_r -> 'values' ->> 'id')::bigint;
  select t.goal_id,
         jsonb_build_object('title', t.title, 'done', t.done, 'assignee', t.assignee,
                            'due_date', to_char(t.due_date, 'YYYY-MM-DD'), 'note', t.note)
    into v_goal, v_cur
    from rumbo.tasks t join rumbo.goals g on g.id = t.goal_id
   where t.id = v_id and g.space_id = p_space_id;
  if not found then
    perform rumbo.fail('not_found', 'Esta tarea ya no existe.');
  end if;
  v_cas := rumbo.cas(p, v_cur, '{
      "title": "text:1:120", "done": "bool", "assignee": "enum?:a|b|both",
      "due_date": "date?", "note": "text:0:500"}'::jsonb);
  if v_cas -> 'conflicts' <> '{}'::jsonb then
    perform rumbo.fail('conflict', rumbo.conflict_message(), v_cas -> 'conflicts', null, rumbo.task_json(v_id));
  end if;
  v_upd := v_cas -> 'updates';
  if v_upd <> '{}'::jsonb then
    update rumbo.tasks t set
      title = case when v_upd ? 'title' then v_upd ->> 'title' else t.title end,
      done = case when v_upd ? 'done' then (v_upd ->> 'done')::boolean else t.done end,
      completed_at = case when v_upd ? 'done'
                          then case when (v_upd ->> 'done')::boolean then now() else null end
                          else t.completed_at end,
      assignee = case when v_upd ? 'assignee' then v_upd ->> 'assignee' else t.assignee end,
      due_date = case when v_upd ? 'due_date' then (v_upd ->> 'due_date')::date else t.due_date end,
      note = case when v_upd ? 'note' then v_upd ->> 'note' else t.note end,
      updated_at = now()
    where t.id = v_id;
    update rumbo.goals g set last_activity_at = now() where g.id = v_goal;
  end if;
  return jsonb_build_object('task', rumbo.task_json(v_id));
end
$$;

create or replace function rumbo.a_delete_task(p_space_id bigint, p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_r     jsonb := rumbo.parse_obj(p, '{"id": "id!"}'::jsonb);
  v_id    bigint;
  v_goal  bigint;
begin
  perform rumbo.require_valid(v_r -> 'errors');
  v_id := (v_r -> 'values' ->> 'id')::bigint;
  select t.goal_id into v_goal
    from rumbo.tasks t join rumbo.goals g on g.id = t.goal_id
   where t.id = v_id and g.space_id = p_space_id;
  if not found then
    perform rumbo.fail('not_found', 'Esta tarea ya no existe.');
  end if;
  delete from rumbo.tasks t where t.id = v_id;
  update rumbo.goals g set last_activity_at = now() where g.id = v_goal;
  return jsonb_build_object('deleted_task_id', v_id);
end
$$;

create or replace function rumbo.a_reorder_tasks(p_space_id bigint, p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_r        jsonb := rumbo.parse_obj(p, '{"goal_id": "id!"}'::jsonb);
  v_goal     bigint;
  v_order    bigint[];
  v_current  bigint[];
begin
  perform rumbo.require_valid(v_r -> 'errors');
  v_goal := (v_r -> 'values' ->> 'goal_id')::bigint;
  perform 1 from rumbo.goals g where g.id = v_goal and g.space_id = p_space_id;
  if not found then
    perform rumbo.fail('not_found', 'Este objetivo ya no existe.');
  end if;
  v_order := rumbo.parse_id_list(p -> 'order');
  select coalesce(array_agg(t.id order by t.id), '{}'::bigint[]) into v_current
    from rumbo.tasks t where t.goal_id = v_goal;
  if cardinality(v_order) <> (select count(distinct u.x) from unnest(v_order) as u(x))
     or (select coalesce(array_agg(u.x order by u.x), '{}'::bigint[]) from unnest(v_order) as u(x)) <> v_current then
    perform rumbo.fail('conflict', rumbo.conflict_message(), null, null,
                      jsonb_build_object('tasks', rumbo.tasks_json(v_goal)));
  end if;
  update rumbo.tasks t set position = (o.idx - 1)::int
    from unnest(v_order) with ordinality as o(task_id, idx)
   where t.id = o.task_id and t.goal_id = v_goal;
  update rumbo.goals g set last_activity_at = now() where g.id = v_goal;
  return jsonb_build_object('tasks', rumbo.tasks_json(v_goal));
end
$$;

-- --- Movimientos -----------------------------------------------------------

create or replace function rumbo.a_add_movement(p_space_id bigint, p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_r          jsonb := rumbo.parse_obj(p, '{
                   "kind": "enum:deposit|deposit_to_goal|allocate|release|transfer|payment|withdrawal!",
                   "amount_cents": "amount!", "date": "date!", "attribution": "enum?:a|b|joint",
                   "note": "text:0:300", "goal_id": "id?", "to_goal_id": "id?",
                   "is_initial": "bool", "cover_shortfall": "bool"}'::jsonb);
  v_vals       jsonb := v_r -> 'values';
  v_errors     jsonb := v_r -> 'errors';
  v_kind       text := v_vals ->> 'kind';
  v_amount     bigint := (v_vals ->> 'amount_cents')::bigint;
  v_date       date := (v_vals ->> 'date')::date;
  v_attr       text := v_vals ->> 'attribution';
  v_note       text := coalesce(v_vals ->> 'note', '');
  v_goal       bigint := (v_vals ->> 'goal_id')::bigint;
  v_to         bigint := (v_vals ->> 'to_goal_id')::bigint;
  v_initial    boolean := coalesce((v_vals ->> 'is_initial')::boolean, false);
  v_cover      boolean := coalesce((v_vals ->> 'cover_shortfall')::boolean, false);
  v_state      jsonb;
  v_available  bigint;
  v_reserved   bigint;
  v_shortfall  bigint;
  v_goal_name  text;
  v_alloc_id   bigint;
  v_created    bigint[] := '{}'::bigint[];
begin
  if v_kind in ('deposit_to_goal', 'allocate', 'release', 'transfer', 'payment') then
    if not (v_errors ? 'goal_id') then
      if v_goal is null then
        v_errors := v_errors || jsonb_build_object('goal_id', 'Elige un objetivo.');
      elsif not exists (select 1 from rumbo.goals g where g.id = v_goal and g.space_id = p_space_id) then
        v_errors := v_errors || jsonb_build_object('goal_id', 'El objetivo no existe.');
      end if;
    end if;
  elsif v_kind is not null and v_goal is not null then
    v_errors := v_errors || jsonb_build_object('goal_id', 'Este tipo de movimiento no va asociado a un objetivo.');
  end if;
  if v_kind = 'transfer' then
    if not (v_errors ? 'to_goal_id') then
      if v_to is null then
        v_errors := v_errors || jsonb_build_object('to_goal_id', 'Elige el objetivo de destino.');
      elsif v_to = v_goal then
        v_errors := v_errors || jsonb_build_object('to_goal_id', 'El destino debe ser un objetivo distinto.');
      elsif not exists (select 1 from rumbo.goals g where g.id = v_to and g.space_id = p_space_id) then
        v_errors := v_errors || jsonb_build_object('to_goal_id', 'El objetivo de destino no existe.');
      end if;
    end if;
  elsif v_to is not null then
    v_errors := v_errors || jsonb_build_object('to_goal_id', 'Solo los traspasos tienen objetivo de destino.');
  end if;
  if v_initial and v_kind is distinct from 'deposit' then
    v_errors := v_errors || jsonb_build_object('is_initial',
                  'Solo un ahorro sin objetivo puede marcarse como ahorros iniciales.');
  end if;
  if v_cover and v_kind is distinct from 'payment' then
    v_errors := v_errors || jsonb_build_object('cover_shortfall', 'Solo se aplica a pagos.');
  end if;
  perform rumbo.require_valid(v_errors);

  v_state := rumbo.replay(p_space_id);
  v_available := (v_state ->> 'available_cents')::bigint;
  v_reserved := case when v_goal is null then 0
                     else coalesce((v_state -> 'reserves' ->> v_goal::text)::bigint, 0) end;
  select g.name into v_goal_name from rumbo.goals g where g.id = v_goal;

  if v_kind = 'allocate' and v_available < v_amount then
    perform rumbo.fail('insufficient_available',
      format('No hay suficiente dinero disponible para asignar: disponible %s.', rumbo.fmt_eur(v_available)),
      null, jsonb_build_object('available_cents', v_available, 'shortfall_cents', v_amount - v_available));
  end if;
  if v_kind = 'withdrawal' and v_available < v_amount then
    perform rumbo.fail('insufficient_available',
      format('Necesitas liberar antes dinero reservado: disponible %s.', rumbo.fmt_eur(v_available)),
      null, jsonb_build_object('available_cents', v_available, 'shortfall_cents', v_amount - v_available));
  end if;
  if v_kind in ('release', 'transfer') and v_reserved < v_amount then
    perform rumbo.fail('insufficient_reserve',
      format('En %s solo hay %s reservados.', rumbo.goal_label(v_goal_name), rumbo.fmt_eur(v_reserved)),
      null, jsonb_build_object('reserved_cents', v_reserved, 'shortfall_cents', v_amount - v_reserved,
                               'available_cents', v_available));
  end if;

  if v_kind = 'payment' and v_reserved < v_amount then
    v_shortfall := v_amount - v_reserved;
    if not v_cover then
      perform rumbo.fail('insufficient_reserve',
        format('Faltan %s reservados en %s para este pago.', rumbo.fmt_eur(v_shortfall), rumbo.goal_label(v_goal_name)),
        null, jsonb_build_object('shortfall_cents', v_shortfall, 'available_cents', v_available,
                                 'reserved_cents', v_reserved));
    end if;
    if v_available < v_shortfall then
      perform rumbo.fail('insufficient_available',
        format('Faltan %s reservados y solo hay %s disponibles para cubrirlos.',
               rumbo.fmt_eur(v_shortfall), rumbo.fmt_eur(v_available)),
        null, jsonb_build_object('shortfall_cents', v_shortfall, 'available_cents', v_available,
                                 'reserved_cents', v_reserved));
    end if;
    -- Asignación automática + pago, atómicos y agrupados.
    v_alloc_id := rumbo.insert_movement(p_space_id, 'allocate', v_shortfall, v_date, v_attr,
                                       'Asignación automática para cubrir un pago',
                                       v_goal, null, false, null, null, null);
    update rumbo.movements mv set group_id = 'g' || v_alloc_id where mv.id = v_alloc_id;
    v_created := v_created || v_alloc_id;
    v_created := v_created || rumbo.insert_movement(p_space_id, 'payment', v_amount, v_date, v_attr, v_note,
                                                   v_goal, null, false, 'g' || v_alloc_id, null, null);
  else
    v_created := v_created || rumbo.insert_movement(p_space_id, v_kind, v_amount, v_date, v_attr, v_note,
                                                   v_goal, v_to, v_initial, null, null, null);
  end if;

  v_state := rumbo.replay(p_space_id);  -- replay completo: valida o lanza ledger_conflict
  return jsonb_build_object('movements', rumbo.movements_json(p_space_id, v_created),
                            'savings', rumbo.savings_json(v_state));
end
$$;

create or replace function rumbo.a_void_movement(p_space_id bigint, p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_r      jsonb := rumbo.parse_obj(p, '{"id": "id!", "reason": "text:0:300"}'::jsonb);
  v_id     bigint;
  v_mv     rumbo.movements%rowtype;
  v_ids    bigint[];
  v_state  jsonb;
begin
  perform rumbo.require_valid(v_r -> 'errors');
  v_id := (v_r -> 'values' ->> 'id')::bigint;
  select * into v_mv from rumbo.movements mv where mv.id = v_id and mv.space_id = p_space_id;
  if not found then
    perform rumbo.fail('not_found', 'Este movimiento no existe.');
  end if;
  if v_mv.status <> 'valid' then
    perform rumbo.fail('conflict',
      case when v_mv.status = 'voided' then 'Este movimiento ya está anulado.' else 'Este movimiento ya está corregido.' end,
      null, null, rumbo.movements_json(p_space_id, array[v_id]) -> 0);
  end if;
  if v_mv.group_id is not null then
    select array_agg(mv.id order by mv.id) into v_ids from rumbo.movements mv
     where mv.space_id = p_space_id and mv.group_id = v_mv.group_id and mv.status = 'valid';
  else
    v_ids := array[v_id];
  end if;
  update rumbo.movements mv set status = 'voided', voided_at = now(),
         void_reason = coalesce(v_r -> 'values' ->> 'reason', '')
   where mv.id = any (v_ids);
  v_state := rumbo.replay(p_space_id);
  return jsonb_build_object('movements', rumbo.movements_json(p_space_id, v_ids),
                            'savings', rumbo.savings_json(v_state));
end
$$;

create or replace function rumbo.a_correct_movement(p_space_id bigint, p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_r      jsonb := rumbo.parse_obj(p, '{
               "id": "id!", "amount_cents": "amount!", "date": "date!",
               "attribution": "enum?:a|b|joint", "note": "text:0:300"}'::jsonb);
  v_vals   jsonb := v_r -> 'values';
  v_id     bigint;
  v_mv     rumbo.movements%rowtype;
  v_new    bigint;
  v_state  jsonb;
  v_list   jsonb;
begin
  perform rumbo.require_valid(v_r -> 'errors');
  v_id := (v_vals ->> 'id')::bigint;
  select * into v_mv from rumbo.movements mv where mv.id = v_id and mv.space_id = p_space_id;
  if not found then
    perform rumbo.fail('not_found', 'Este movimiento no existe.');
  end if;
  if v_mv.status <> 'valid' then
    perform rumbo.fail('conflict',
      case when v_mv.status = 'voided' then 'Este movimiento ya está anulado.' else 'Este movimiento ya está corregido.' end,
      null, null, rumbo.movements_json(p_space_id, array[v_id]) -> 0);
  end if;
  if v_mv.group_id is not null then
    perform rumbo.fail('grouped_movement',
      'Este movimiento forma parte de una operación combinada. Anúlalo y regístralo de nuevo.');
  end if;

  v_new := rumbo.insert_movement(
    p_space_id, v_mv.kind, (v_vals ->> 'amount_cents')::bigint, (v_vals ->> 'date')::date,
    case when v_vals ? 'attribution' then v_vals ->> 'attribution' else v_mv.attribution end,
    case when v_vals ? 'note' then v_vals ->> 'note' else v_mv.note end,
    v_mv.goal_id, v_mv.to_goal_id, v_mv.is_initial, null, v_mv.order_key, v_mv.id);
  update rumbo.movements mv set status = 'corrected', replaced_by_id = v_new where mv.id = v_id;

  v_state := rumbo.replay(p_space_id);  -- lanza ledger_conflict si deja algo imposible
  v_list := rumbo.movements_json(p_space_id, array[v_id, v_new]);
  return jsonb_build_object(
    'movement', (select e.val from jsonb_array_elements(v_list) as e(val) where (e.val ->> 'id')::bigint = v_new),
    'movements', v_list,
    'savings', rumbo.savings_json(v_state));
end
$$;

-- -----------------------------------------------------------------------------
-- Creación de espacios y datos de demostración
-- -----------------------------------------------------------------------------

create or replace function rumbo.create_default_tabs(p_space_id bigint)
returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into rumbo.tabs (space_id, name, position)
  select p_space_id, d.name, (d.idx - 1)::int
    from unnest(array['Vivienda', 'Movilidad', 'Trámites y formación', 'Boda y celebraciones',
                      'Viajes y experiencias', 'Hogar', 'Seguridad económica', 'Otros'])
         with ordinality as d(name, idx);
end
$$;

-- Atajo para la demo: registra un movimiento con la acción real y devuelve
-- el id del último movimiento creado.
create or replace function rumbo.demo_mv(
  p_space_id bigint, p_kind text, p_amount bigint, p_date date, p_goal_id bigint,
  p_extra jsonb default '{}'::jsonb)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_res jsonb;
begin
  v_res := rumbo.a_add_movement(p_space_id,
    jsonb_build_object('kind', p_kind, 'amount_cents', p_amount, 'date', to_char(p_date, 'YYYY-MM-DD'))
    || case when p_goal_id is null then '{}'::jsonb else jsonb_build_object('goal_id', p_goal_id) end
    || p_extra);
  return (v_res -> 'movements' -> 0 ->> 'id')::bigint;
end
$$;

create or replace function rumbo.demo_goal(p_space_id bigint, p_tab_name text, p_goal jsonb)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_tab bigint;
begin
  select t.id into v_tab from rumbo.tabs t where t.space_id = p_space_id and t.name = p_tab_name;
  return (rumbo.a_create_goal(p_space_id, p_goal || jsonb_build_object('tab_id', v_tab)) -> 'goal' ->> 'id')::bigint;
end
$$;

-- Datos ficticios coherentes, creados con las MISMAS acciones que usa la app
-- (cada movimiento pasa por la validación y el replay del libro).
create or replace function rumbo.seed_demo(p_space_id bigint)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_today    date := rumbo.today();
  v_piso     bigint;
  v_fondo    bigint;
  v_japon    bigint;
  v_cocina   bigint;
  v_curso    bigint;
  v_coche    bigint;
  v_mv       bigint;
  v_task     bigint;
begin
  perform rumbo.a_set_names(p_space_id, '{"changes": {"name_a": "Lucía", "name_b": "Daniel"},
                                         "base": {"name_a": "", "name_b": ""}}'::jsonb);

  v_piso := rumbo.demo_goal(p_space_id, 'Vivienda', jsonb_build_object(
    'name', 'Entrada del piso', 'target_cents', 2400000, 'beneficiary', 'both', 'priority', 'high',
    'description', 'Entrada y gastos de compra de un piso de dos habitaciones',
    'desired_date', to_char(v_today + interval '24 months', 'YYYY-MM-DD'),
    'notes', 'Calculado con un 20 % de entrada más un 10 % de gastos.',
    'tasks', jsonb_build_array(
      jsonb_build_object('title', 'Comparar hipotecas en tres bancos'),
      jsonb_build_object('title', 'Pedir la nota simple del piso que nos gusta'),
      jsonb_build_object('title', 'Calcular gastos de notaría e impuestos'))));

  v_fondo := rumbo.demo_goal(p_space_id, 'Seguridad económica', jsonb_build_object(
    'name', 'Fondo de emergencia', 'target_cents', 900000, 'beneficiary', 'both', 'priority', 'high',
    'description', 'Seis meses de gastos fijos',
    'notes', 'No tocar salvo imprevistos de verdad.'));

  v_japon := rumbo.demo_goal(p_space_id, 'Viajes y experiencias', jsonb_build_object(
    'name', 'Viaje a Japón', 'beneficiary', 'both', 'priority', 'medium',
    'description', 'Dos semanas en primavera',
    'desired_date', to_char(v_today + interval '10 months', 'YYYY-MM-DD'),
    'budget_items', jsonb_build_array(
      jsonb_build_object('label', 'Vuelos', 'amount_cents', 180000),
      jsonb_build_object('label', 'Alojamiento', 'amount_cents', 210000),
      jsonb_build_object('label', 'Transporte interno', 'amount_cents', 60000),
      jsonb_build_object('label', 'Comidas y entradas', 'amount_cents', 100000)),
    'tasks', jsonb_build_array(
      jsonb_build_object('title', 'Renovar pasaportes'),
      jsonb_build_object('title', 'Reservar vuelos'),
      jsonb_build_object('title', 'Reservar alojamiento en Kioto'))));

  v_cocina := rumbo.demo_goal(p_space_id, 'Hogar', jsonb_build_object(
    'name', 'Reformar la cocina', 'target_cents', 800000, 'beneficiary', 'both', 'priority', 'medium',
    'desired_date', to_char(v_today - interval '1 month', 'YYYY-MM-DD'),
    'tasks', jsonb_build_array(
      jsonb_build_object('title', 'Pedir tres presupuestos'),
      jsonb_build_object('title', 'Elegir electrodomésticos'))));

  v_curso := rumbo.demo_goal(p_space_id, 'Trámites y formación', jsonb_build_object(
    'name', 'Curso de inglés', 'target_cents', 60000, 'beneficiary', 'b', 'priority', 'low',
    'description', 'Curso intensivo de nivel C1',
    'tasks', jsonb_build_array(
      jsonb_build_object('title', 'Elegir academia'),
      jsonb_build_object('title', 'Formalizar la matrícula'))));

  v_coche := rumbo.demo_goal(p_space_id, 'Movilidad', jsonb_build_object(
    'name', 'Coche eléctrico de segunda mano', 'target_cents', 1500000, 'beneficiary', 'both',
    'priority', 'low'));

  -- Movimientos en orden cronológico de registro.
  perform rumbo.demo_mv(p_space_id, 'deposit', 1200000, v_today - 150, null,
                       '{"is_initial": true, "attribution": "joint", "note": "Ahorros iniciales"}'::jsonb);
  perform rumbo.demo_mv(p_space_id, 'allocate', 400000, v_today - 150, v_fondo);
  perform rumbo.demo_mv(p_space_id, 'allocate', 500000, v_today - 140, v_piso);
  perform rumbo.demo_mv(p_space_id, 'deposit_to_goal', 50000, v_today - 120, v_japon,
                       '{"attribution": "a", "note": "Regalo de cumpleaños"}'::jsonb);
  perform rumbo.demo_mv(p_space_id, 'deposit', 150000, v_today - 90, null,
                       '{"attribution": "a", "note": "Ahorro del mes"}'::jsonb);
  v_mv := rumbo.demo_mv(p_space_id, 'deposit', 140000, v_today - 60, null,
                       '{"attribution": "b", "note": "Ahorro del mes"}'::jsonb);
  perform rumbo.a_correct_movement(p_space_id, jsonb_build_object(
    'id', v_mv, 'amount_cents', 150000, 'date', to_char(v_today - 60, 'YYYY-MM-DD'),
    'note', 'Ahorro del mes (importe corregido)'));
  perform rumbo.demo_mv(p_space_id, 'allocate', 50000, v_today - 60, v_coche);
  perform rumbo.demo_mv(p_space_id, 'allocate', 60000, v_today - 60, v_curso);
  perform rumbo.demo_mv(p_space_id, 'payment', 60000, v_today - 45, v_curso,
                       '{"note": "Matrícula del curso"}'::jsonb);
  perform rumbo.demo_mv(p_space_id, 'allocate', 150000, v_today - 30, v_japon);
  perform rumbo.demo_mv(p_space_id, 'allocate', 100000, v_today - 30, v_cocina);
  perform rumbo.demo_mv(p_space_id, 'withdrawal', 30000, v_today - 20, null,
                       '{"attribution": "joint", "note": "Reparación de la caldera"}'::jsonb);
  perform rumbo.demo_mv(p_space_id, 'transfer', 20000, v_today - 15, v_cocina,
                       jsonb_build_object('to_goal_id', v_japon, 'note', 'Priorizamos el viaje'));
  perform rumbo.demo_mv(p_space_id, 'deposit_to_goal', 80000, v_today - 7, v_piso,
                       '{"attribution": "b", "note": "Paga extra"}'::jsonb);
  perform rumbo.demo_mv(p_space_id, 'payment', 180000, v_today - 3, v_japon,
                       '{"attribution": "joint", "note": "Vuelos reservados"}'::jsonb);
  v_mv := rumbo.demo_mv(p_space_id, 'deposit', 25000, v_today - 2, null,
                       '{"attribution": "a", "note": "Ahorro del mes"}'::jsonb);
  perform rumbo.a_void_movement(p_space_id, jsonb_build_object('id', v_mv, 'reason', 'Registrado dos veces'));

  -- Progreso de tareas y estados.
  for v_task in
    select t.id from rumbo.tasks t
     where (t.goal_id = v_piso and t.position = 0)
        or (t.goal_id = v_japon and t.position in (0, 1))
        or (t.goal_id = v_cocina and t.position = 0)
        or t.goal_id = v_curso
  loop
    perform rumbo.a_update_task(p_space_id, jsonb_build_object(
      'id', v_task, 'changes', jsonb_build_object('done', true), 'base', jsonb_build_object('done', false)));
  end loop;
  select t.id into v_task from rumbo.tasks t where t.goal_id = v_cocina and t.position = 1;
  perform rumbo.a_update_task(p_space_id, jsonb_build_object(
    'id', v_task,
    'changes', jsonb_build_object('assignee', 'a', 'due_date', to_char(v_today + 20, 'YYYY-MM-DD')),
    'base', jsonb_build_object('assignee', null, 'due_date', null)));
  perform rumbo.a_create_task(p_space_id, jsonb_build_object(
    'goal_id', v_piso, 'title', 'Visitar pisos los sábados', 'assignee', 'both',
    'due_date', to_char(v_today + 14, 'YYYY-MM-DD')));

  perform rumbo.a_update_goal(p_space_id, '{"changes": {"status": "done"}, "base": {"status": "active"}}'::jsonb
                                         || jsonb_build_object('id', v_curso));
  perform rumbo.a_update_goal(p_space_id, '{"changes": {"status": "paused"}, "base": {"status": "active"}}'::jsonb
                                         || jsonb_build_object('id', v_coche));
end
$$;

-- -----------------------------------------------------------------------------
-- API pública (las únicas funciones accesibles con la clave pública)
-- -----------------------------------------------------------------------------

create or replace function public.rumbo_create_space(
  p_secret text, p_demo boolean default false, p_setup_code text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_demo      boolean := coalesce(p_demo, false);
  v_settings  rumbo.settings%rowtype;
  v_hash      text;
  v_count     int;
  v_id        bigint;
  v_old       bigint;
begin
  if not rumbo.valid_secret(p_secret) then
    perform rumbo.require_valid(jsonb_build_object('secret', 'El enlace generado no es válido.'));
  end if;
  v_hash := rumbo.secret_hash(p_secret);

  insert into rumbo.settings (id) values (1) on conflict (id) do nothing;
  -- Bloquea la configuración: serializa las creaciones y hace exacto el límite.
  select * into v_settings from rumbo.settings st where st.id = 1 for update;

  if v_demo then
    -- Purga por lotes de demos caducadas (acota el trabajo de cada llamada).
    for v_old in
      select s.id from rumbo.spaces s
       where s.is_demo and s.created_at < now() - interval '24 hours'
       order by s.created_at limit 5
    loop
      delete from rumbo.movements mv where mv.space_id = v_old;
      delete from rumbo.spaces s where s.id = v_old;
    end loop;
    select count(*)::int into v_count from rumbo.spaces s
     where s.is_demo and not rumbo.demo_expired(s.is_demo, s.created_at);
    if v_count >= 30 then
      perform rumbo.fail('limit_reached',
        'Ahora mismo hay demasiadas demostraciones abiertas. Inténtalo de nuevo más tarde.');
    end if;
  else
    if coalesce(v_settings.setup_code, '') <> '' then
      if coalesce(p_setup_code, '') = '' then
        perform rumbo.fail('setup_code_required', 'Hace falta el código de configuración para crear un espacio.',
                          jsonb_build_object('setup_code', 'Hace falta el código de configuración para crear un espacio.'));
      elsif p_setup_code <> v_settings.setup_code then
        perform rumbo.fail('setup_code_required', 'El código de configuración no es correcto.',
                          jsonb_build_object('setup_code', 'El código de configuración no es correcto.'));
      end if;
    end if;
    select count(*)::int into v_count from rumbo.spaces s where not s.is_demo;
    if v_count >= v_settings.max_real_spaces then
      perform rumbo.fail('limit_reached',
        format('Esta instalación ya tiene el máximo de espacios permitidos (%s). Para crear otro, '
               || 'aumenta max_real_spaces en la tabla rumbo.settings de Supabase.', v_settings.max_real_spaces),
        null, jsonb_build_object('max_real_spaces', v_settings.max_real_spaces));
    end if;
  end if;

  if exists (select 1 from rumbo.spaces s where s.token_hash = v_hash) then
    perform rumbo.require_valid(jsonb_build_object('secret', 'Este enlace ya está en uso. Genera otro.'));
  end if;

  insert into rumbo.spaces (token_hash, is_demo) values (v_hash, v_demo) returning id into v_id;
  perform rumbo.create_default_tabs(v_id);
  if v_demo then
    perform rumbo.seed_demo(v_id);
  end if;
  return jsonb_build_object('space', rumbo.space_json(v_id));
end
$$;

create or replace function public.rumbo_get_state(p_secret text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return rumbo.state_json(rumbo.space_id_by_secret(p_secret));
end
$$;

create or replace function public.rumbo_get_rev(p_secret text)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id   bigint := rumbo.space_id_by_secret(p_secret);
  v_rev  bigint;
begin
  select s.rev into v_rev from rumbo.spaces s where s.id = v_id;
  return v_rev;
end
$$;

-- Dispatcher único de escrituras.
create or replace function public.rumbo_mutate(p_secret text, p_op_id text, p_action text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space_id   bigint;
  v_payload    jsonb := coalesce(p_payload, '{}'::jsonb);
  v_op_action  text;
  v_op_resp    jsonb;
  v_result     jsonb;
  v_rev        bigint;
  v_response   jsonb;
  v_is_demo    boolean;
  v_ops_day    int;
  v_ops_bytes  bigint;
  v_max_ops    int;
  v_max_bytes  bigint;
begin
  if not rumbo.valid_secret(p_secret) then
    perform rumbo.fail('unauthorized', 'Este enlace no es válido o ha sido regenerado.');
  end if;
  -- Bloquea el espacio: las escrituras concurrentes del mismo espacio se serializan.
  select s.id, s.is_demo into v_space_id, v_is_demo from rumbo.spaces s
   where s.token_hash = rumbo.secret_hash(p_secret) and not rumbo.demo_expired(s.is_demo, s.created_at)
     for update;
  if not found then
    perform rumbo.fail('unauthorized', 'Este enlace no es válido o ha sido regenerado.');
  end if;

  if p_op_id is null or char_length(p_op_id) < 8 or char_length(p_op_id) > 64 then
    perform rumbo.require_valid(jsonb_build_object('op_id', 'Identificador de operación no válido (8–64 caracteres).'));
  end if;
  if p_action is null or not (p_action = any (array[
       'set_names', 'create_tab', 'rename_tab', 'reorder_tabs', 'delete_tab',
       'create_goal', 'update_goal', 'set_budget', 'delete_goal',
       'create_task', 'update_task', 'delete_task', 'reorder_tasks',
       'add_movement', 'void_movement', 'correct_movement', 'regenerate_link'])) then
    perform rumbo.require_valid(jsonb_build_object('action', 'Acción desconocida.'));
  end if;
  if jsonb_typeof(v_payload) <> 'object' then
    perform rumbo.require_valid(jsonb_build_object('payload', 'Los datos de la operación deben ser un objeto JSON.'));
  end if;
  if pg_column_size(v_payload) > 65536 then
    perform rumbo.require_valid(jsonb_build_object('payload', 'La operación es demasiado grande (máximo 64 KB).'));
  end if;

  -- Idempotencia: un reintento con el mismo op_id devuelve la respuesta guardada.
  select o.action, o.response into v_op_action, v_op_resp
    from rumbo.ops o where o.space_id = v_space_id and o.op_id = p_op_id;
  if found then
    if v_op_action = p_action then
      return v_op_resp;
    end if;
    perform rumbo.fail('op_reused', 'Este identificador de operación ya se usó para otra acción.');
  end if;

  -- Cuotas por espacio (después de la idempotencia: un reintento siempre
  -- obtiene su respuesta). Acotan cuánto puede crecer rumbo.ops, que guarda la
  -- respuesta completa de cada operación durante 7 días.
  delete from rumbo.ops o where o.space_id = v_space_id and o.created_at < now() - interval '7 days';
  v_max_ops := case when v_is_demo then 500 else 3000 end;
  v_max_bytes := case when v_is_demo then 2097152 else 20971520 end;  -- 2 MB / 20 MB
  select count(*) filter (where o.created_at > now() - interval '24 hours')::int,
         coalesce(sum(pg_column_size(o.response)), 0)::bigint
    into v_ops_day, v_ops_bytes
    from rumbo.ops o where o.space_id = v_space_id;
  if v_ops_day >= v_max_ops or v_ops_bytes >= v_max_bytes then
    perform rumbo.fail('limit_reached',
      'Se han hecho demasiados cambios en poco tiempo en este espacio. Espera un rato y vuelve a intentarlo.',
      null, jsonb_build_object('max_ops_per_day', v_max_ops, 'max_ops_bytes', v_max_bytes));
  end if;

  -- Cada acción que toca dinero (add_movement, void_movement, correct_movement y
  -- update_goal con devolución de reserva) reproduce el libro completo antes de
  -- terminar; si algo queda imposible lanza ledger_conflict y se revierte todo.
  v_result := case p_action
    when 'set_names'        then rumbo.a_set_names(v_space_id, v_payload)
    when 'create_tab'       then rumbo.a_create_tab(v_space_id, v_payload)
    when 'rename_tab'       then rumbo.a_rename_tab(v_space_id, v_payload)
    when 'reorder_tabs'     then rumbo.a_reorder_tabs(v_space_id, v_payload)
    when 'delete_tab'       then rumbo.a_delete_tab(v_space_id, v_payload)
    when 'create_goal'      then rumbo.a_create_goal(v_space_id, v_payload)
    when 'update_goal'      then rumbo.a_update_goal(v_space_id, v_payload)
    when 'set_budget'       then rumbo.a_set_budget(v_space_id, v_payload)
    when 'delete_goal'      then rumbo.a_delete_goal(v_space_id, v_payload)
    when 'create_task'      then rumbo.a_create_task(v_space_id, v_payload)
    when 'update_task'      then rumbo.a_update_task(v_space_id, v_payload)
    when 'delete_task'      then rumbo.a_delete_task(v_space_id, v_payload)
    when 'reorder_tasks'    then rumbo.a_reorder_tasks(v_space_id, v_payload)
    when 'add_movement'     then rumbo.a_add_movement(v_space_id, v_payload)
    when 'void_movement'    then rumbo.a_void_movement(v_space_id, v_payload)
    when 'correct_movement' then rumbo.a_correct_movement(v_space_id, v_payload)
    when 'regenerate_link'  then rumbo.a_regenerate_link(v_space_id, v_payload)
  end;

  update rumbo.spaces s set rev = s.rev + 1 where s.id = v_space_id returning s.rev into v_rev;
  v_response := jsonb_build_object('result', v_result, 'rev', v_rev);

  -- Las claves de idempotencia solo sirven para reintentos cercanos (se purgan
  -- a los 7 días, antes de comprobar las cuotas).
  -- regenerate_link devuelve solo {ok:true}: el nuevo secreto nunca se guarda.
  insert into rumbo.ops (space_id, op_id, action, response) values (v_space_id, p_op_id, p_action, v_response);
  return v_response;
end
$$;

-- -----------------------------------------------------------------------------
-- Privilegios
-- -----------------------------------------------------------------------------

revoke all on all tables in schema rumbo from public, anon, authenticated;
revoke all on all sequences in schema rumbo from public, anon, authenticated;
revoke all on all functions in schema rumbo from public, anon, authenticated;

revoke all on function public.rumbo_create_space(text, boolean, text) from public;
revoke all on function public.rumbo_get_state(text) from public;
revoke all on function public.rumbo_get_rev(text) from public;
revoke all on function public.rumbo_mutate(text, text, text, jsonb) from public;

grant execute on function public.rumbo_create_space(text, boolean, text) to anon, authenticated;
grant execute on function public.rumbo_get_state(text) to anon, authenticated;
grant execute on function public.rumbo_get_rev(text) to anon, authenticated;
grant execute on function public.rumbo_mutate(text, text, text, jsonb) to anon, authenticated;

comment on schema rumbo is 'Datos privados de «Rumbo». No se expone por la API: solo las funciones public.rumbo_*.';
comment on function public.rumbo_create_space(text, boolean, text) is 'Crea un espacio (real o demo) a partir de un secreto generado por el cliente.';
comment on function public.rumbo_get_state(text) is 'Estado completo del espacio del secreto.';
comment on function public.rumbo_get_rev(text) is 'Revisión actual del espacio (sondeo barato).';
comment on function public.rumbo_mutate(text, text, text, jsonb) is 'Única vía de escritura: acciones idempotentes por op_id.';
