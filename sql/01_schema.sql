-- ============================================================
-- 家計簿アプリ スキーマ定義 v1.2
-- Supabase (PostgreSQL) SQL Editor で実行する
-- ============================================================

-- ---------- ENUM ----------
create type owner_type    as enum ('共通', 'りほ', 'ゆうき');
create type entry_kind    as enum ('支出', '収入', '貯蓄');
create type tx_source     as enum ('auto', 'manual', 'fixed');
create type pocket_kind   as enum ('living', 'annual', 'savings');
create type freq_type     as enum ('monthly', 'specific_months', 'yearly');
create type budget_period as enum ('monthly', 'yearly');

-- ---------- users ----------
-- Supabase Auth とは auth_user_id で紐づける。
-- name を自然キーとして扱うため、マスタ投入時に uuid を知らなくてよい。
create table users (
  id            serial primary key,
  name          owner_type not null unique,
  auth_user_id  uuid references auth.users(id),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ---------- pockets（お金の器）----------
create table pockets (
  id          serial primary key,
  name        text not null unique,
  kind        pocket_kind not null,
  sort_order  int not null default 0
);

comment on table pockets is
  '生活費 / 年間支出 / 貯蓄 の集計区分。実際に銀行口座を分けるかは運用の自由。
   年間支出は積立を行わず、発生した実績を記録するだけの器。';

-- ---------- categories ----------
create table categories (
  id          serial primary key,
  name        text not null unique,
  owner       owner_type not null,
  kind        entry_kind not null,
  pocket_id   int not null references pockets(id),
  is_variable boolean not null default false,  -- true = 家計簿で日々追う変動費
  sort_order  int not null default 0,
  is_active   boolean not null default true
);

comment on column categories.is_active is
  '廃止時も物理削除しない。過去の明細が参照しているため。';
comment on column categories.kind is
  '貯蓄(個人年金・自社株・投資信託・NISA)は支出集計から除外する。
   旧シートではこれを支出と貯蓄目標に二重計上していた。';

-- ---------- category_budgets（期間つき予算）----------
create table category_budgets (
  id          serial primary key,
  category_id int not null references categories(id),
  amount      int not null,
  period      budget_period not null default 'monthly',
  valid_from  date not null,
  valid_to    date,                            -- null = 現在有効
  created_at  timestamptz not null default now()
);

create index idx_budgets_category on category_budgets(category_id, valid_from);

comment on table category_budgets is
  '引越し・昇給・育休はこのテーブルで吸収する。
   旧行に valid_to を入れて閉じ、新行を追加する。過去月の集計は当時の金額のまま保たれる。
   valid_from に未来日を入れれば予約もできる（育休開始月が決まったら登録するだけでよい）。';

-- 同一カテゴリで期間が重ならないことを保証
create or replace function check_budget_overlap() returns trigger as $$
begin
  if exists (
    select 1 from category_budgets b
    where b.category_id = new.category_id
      and b.id <> coalesce(new.id, -1)
      and daterange(b.valid_from, b.valid_to, '[]')
          && daterange(new.valid_from, new.valid_to, '[]')
  ) then
    raise exception '予算の適用期間が重複しています (category_id=%)', new.category_id;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_budget_overlap
  before insert or update on category_budgets
  for each row execute function check_budget_overlap();

-- ---------- fixed_entries（固定収支マスタ）----------
create table fixed_entries (
  id                 serial primary key,
  name               text not null,
  kind               entry_kind not null,
  category_id        int not null references categories(id),
  amount             int not null,
  payer              owner_type not null,
  day_of_month       int not null default 1 check (day_of_month between 1 and 31),
  frequency          freq_type not null default 'monthly',
  months             int[],                    -- specific_months のとき {3,6,9,12} 等
  is_variable_amount boolean not null default false,  -- true = 実額確定時に手入力（ボーナス）
  auto_post          boolean not null default true,   -- false = 自動計上しない
  valid_from         date not null,
  valid_to           date,
  created_at         timestamptz not null default now()
);

comment on column fixed_entries.auto_post is
  '家賃・光熱費など口座引落はデビットのメールが来ないため、ここから自動計上する。';

-- ---------- contributions（共通口座への拠出額）----------
create table contributions (
  id         serial primary key,
  user_id    int not null references users(id),
  amount     int not null,
  valid_from date not null,
  valid_to   date,
  created_at timestamptz not null default now()
);

comment on table contributions is
  '共通りそな口座へ毎月入れる基準額。実際の入金額は 基準額 − 当月の立替合計。';

-- ---------- merchant_rules（店名→カテゴリ 学習ルール）----------
create table merchant_rules (
  id          serial primary key,
  pattern     text not null,        -- 店名の部分一致（大文字で保持）
  category_id int not null references categories(id),
  priority    int not null default 0,
  hit_count   int not null default 0,
  created_at  timestamptz not null default now()
);

create unique index idx_rules_pattern on merchant_rules(upper(pattern));

comment on table merchant_rules is
  'AIは使わない。振り分け画面で「今後この店は自動で分類」を選ぶとここに登録され、
   次回から自動適用される。従量課金が発生せず、使うほど未分類が減る。';

-- ---------- transactions（明細）----------
create table transactions (
  id               uuid primary key default gen_random_uuid(),
  occurred_at      timestamptz not null,
  type             entry_kind not null,
  category_id      int references categories(id),   -- null = 未分類
  merchant         text not null default '',
  amount           int not null,                    -- 返金・取消はマイナス
  payer            owner_type not null default '共通',
  pocket_id        int not null references pockets(id),
  memo             text not null default '',
  gmail_message_id text unique,                     -- 重複排除キー（自動取込のみ）
  approval_no      text,                            -- 照合用。UNIQUEにはしない
  is_refund        boolean not null default false,
  source           tx_source not null default 'manual',
  is_settled       boolean not null default false,  -- 立替の精算済フラグ
  fixed_entry_id   int references fixed_entries(id),
  period_month     date,                            -- 固定計上の対象月（月初日）
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- 承認番号は6桁しかなく衝突しうるため、Gmailメッセージ ID を重複排除キーにする。
-- 固定収支は「同じ月に同じマスタから二重計上しない」ことを保証する。
create unique index idx_tx_fixed_once
  on transactions(fixed_entry_id, period_month)
  where fixed_entry_id is not null;

create index idx_tx_occurred  on transactions(occurred_at desc);
create index idx_tx_category  on transactions(category_id);
create index idx_tx_unclassified on transactions(occurred_at) where category_id is null;
create index idx_tx_settle on transactions(payer, is_settled)
  where payer <> '共通' and is_settled = false;

create or replace function touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_tx_touch
  before update on transactions
  for each row execute function touch_updated_at();

-- ---------- savings_goals（年間貯蓄ゴール）----------
create table savings_goals (
  id            serial primary key,
  year          int not null,
  category_id   int not null references categories(id),
  target_amount int not null,
  unique (year, category_id)
);

-- ---------- import_errors（取込エラーログ）----------
create table import_errors (
  id               serial primary key,
  gmail_message_id text,
  subject          text,
  reason           text not null,
  raw_excerpt      text,
  created_at       timestamptz not null default now()
);

comment on table import_errors is
  '対象メールなのにパースできなかったケースを記録する。
   メールフォーマットが変わった際に無言で取りこぼすのを防ぐ。';

-- ---------- settings ----------
create table settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

-- ============================================================
-- ビュー
-- ============================================================

-- 当月有効な予算（月額に正規化）
create or replace view v_current_budgets as
select
  c.id            as category_id,
  c.name,
  c.owner,
  c.kind,
  c.is_variable,
  p.kind          as pocket_kind,
  b.amount,
  b.period,
  case when b.period = 'yearly' then round(b.amount / 12.0) else b.amount end as monthly_amount,
  b.valid_from,
  b.valid_to
from categories c
join pockets p on p.id = c.pocket_id
left join category_budgets b
  on b.category_id = c.id
 and b.valid_from <= current_date
 and (b.valid_to is null or b.valid_to >= current_date)
where c.is_active;

-- 明細＋カテゴリ情報
create or replace view v_transactions as
select
  t.*,
  c.name        as category_name,
  c.owner       as category_owner,
  c.kind        as category_kind,
  c.is_variable,
  p.kind        as pocket_kind,
  date_trunc('month', t.occurred_at)::date as month
from transactions t
left join categories c on c.id = t.category_id
join pockets p on p.id = t.pocket_id;

-- ============================================================
-- 関数
-- ============================================================

-- 指定月の固定収支を transactions に自動計上する。
-- 同じ月に二重計上されないことは idx_tx_fixed_once が保証する。
create or replace function fn_generate_fixed(target_month date)
returns int as $$
declare
  inserted int;
  m date := date_trunc('month', target_month)::date;
begin
  insert into transactions
    (occurred_at, type, category_id, merchant, amount, payer, pocket_id,
     source, fixed_entry_id, period_month)
  select
    (m + (least(f.day_of_month,
                extract(day from (m + interval '1 month' - interval '1 day'))::int
          ) - 1) * interval '1 day')::timestamptz,
    f.kind,
    f.category_id,
    f.name,
    f.amount,
    f.payer,
    c.pocket_id,
    'fixed',
    f.id,
    m
  from fixed_entries f
  join categories c on c.id = f.category_id
  where f.auto_post
    and f.valid_from <= m
    and (f.valid_to is null or f.valid_to >= m)
    and (
      f.frequency = 'monthly'
      or (f.frequency = 'specific_months'
          and extract(month from m)::int = any(f.months))
      or (f.frequency = 'yearly'
          and extract(month from m)::int = coalesce(f.months[1], 1))
    )
  on conflict (fixed_entry_id, period_month) do nothing;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$ language plpgsql;

-- 指定月の拠出額（基準額 − 当月の立替合計）
create or replace function fn_contributions(target_month date)
returns table (user_name owner_type, base_amount int, advanced int, to_pay int) as $$
  with m as (
    select date_trunc('month', target_month)::date as ms,
           (date_trunc('month', target_month) + interval '1 month')::date as me
  )
  select
    u.name,
    co.amount,
    coalesce(adv.total, 0)::int,
    (co.amount - coalesce(adv.total, 0))::int
  from users u
  cross join m
  join contributions co
    on co.user_id = u.id
   and co.valid_from <= m.ms
   and (co.valid_to is null or co.valid_to >= m.ms)
  left join (
    select t.payer, sum(t.amount) as total
    from transactions t
    join categories c on c.id = t.category_id
    join pockets p on p.id = c.pocket_id
    cross join m
    where t.payer <> '共通'
      and t.type = '支出'
      and p.kind <> 'annual'          -- 年間支出は精算対象外
      and t.source <> 'fixed'         -- 個人の固定費は立替ではない
      and t.occurred_at >= m.ms and t.occurred_at < m.me
    group by t.payer
  ) adv on adv.payer = u.name
  where u.is_active;
$$ language sql stable;

comment on function fn_contributions is
  '年間支出（旅行・住民税など）は各自の個人口座から支払い、精算対象外とする。';

-- ============================================================
-- RLS（利用者は2名のみ。ログイン済なら全データにアクセス可）
-- ============================================================
alter table users            enable row level security;
alter table pockets          enable row level security;
alter table categories       enable row level security;
alter table category_budgets enable row level security;
alter table fixed_entries    enable row level security;
alter table contributions    enable row level security;
alter table merchant_rules   enable row level security;
alter table transactions     enable row level security;
alter table savings_goals    enable row level security;
alter table import_errors    enable row level security;
alter table settings         enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'users','pockets','categories','category_budgets','fixed_entries',
    'contributions','merchant_rules','transactions','savings_goals',
    'import_errors','settings'
  ] loop
    execute format(
      'create policy "authenticated_all" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
