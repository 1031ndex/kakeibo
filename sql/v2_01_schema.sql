-- ============================================================
-- 家計簿アプリ v2.0 — 作り直し
--
-- 【v1からの変更】
--  - 共通りそな口座と貯蓄口座を完全に分離した
--  - 個人口座から出る支出（スマホ・美容室・お小遣い・奨学金など）は
--    アプリの管理対象外にした
--  - 貯蓄口座（現金）と運用資産（年金・自社株・投信）を別々に集計する
--  - 月の繰越を計算できるようにした
--
-- 既存のプロジェクトに流す場合は 00_reset.sql を先に実行する
-- ============================================================

-- ---------- ENUM ----------
do $$ begin
  create type owner_type  as enum ('共通', 'りほ', 'ゆうき');
exception when duplicate_object then null; end $$;

do $$ begin
  create type entry_kind  as enum ('支出', '収入');
exception when duplicate_object then null; end $$;

do $$ begin
  create type tx_source   as enum ('auto', 'manual', 'fixed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type account_kind as enum ('resona', 'savings', 'invest');
exception when duplicate_object then null; end $$;

do $$ begin
  create type freq_type   as enum ('monthly', 'specific_months', 'yearly');
exception when duplicate_object then null; end $$;

-- ---------- users ----------
create table users (
  id         serial primary key,
  name       owner_type not null unique,
  auth_user_id uuid references auth.users(id),
  is_active  boolean not null default true
);

-- ---------- accounts（口座）----------
-- resona  : 共通りそな。日々の生活費
-- savings : 貯蓄口座。毎月10万＋ボーナス＋還付金が入り、年間支出を出す
-- invest  : 運用資産。個人年金・自社株・投資信託。現金ではないので残高を混ぜない
create table accounts (
  id         serial primary key,
  name       text not null unique,
  kind       account_kind not null,
  sort_order int not null default 0
);

comment on table accounts is
  '貯蓄口座と運用資産を分ける理由: 年間支出を払えるのは現金だけであり、
   運用資産を残高に足すと「あといくら使えるか」が分からなくなるため。';

-- ---------- categories ----------
create table categories (
  id          serial primary key,
  name        text not null unique,
  account_id  int not null references accounts(id),
  kind        entry_kind not null,
  is_variable boolean not null default false,  -- true = デビットで日々使う変動費
  sort_order  int not null default 0,
  is_active   boolean not null default true
);

-- ---------- category_budgets（期間つき予算）----------
create table category_budgets (
  id          serial primary key,
  category_id int not null references categories(id) on delete cascade,
  amount      int not null,
  valid_from  date not null,
  valid_to    date,
  created_at  timestamptz not null default now()
);

create index idx_budgets_category on category_budgets(category_id, valid_from);

comment on table category_budgets is
  '引越し・昇給・育休はこのテーブルで吸収する。旧行に valid_to を入れて閉じ、新行を足す。
   valid_from に未来日を入れれば予約もできる。';

create or replace function check_budget_overlap() returns trigger as $$
begin
  if exists (
    select 1 from category_budgets b
    where b.category_id = new.category_id
      and b.id <> coalesce(new.id, -1)
      and daterange(b.valid_from, b.valid_to, '[]')
          && daterange(new.valid_from, new.valid_to, '[]')
  ) then
    raise exception '予算の適用期間が重複しています';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_budget_overlap
  before insert or update on category_budgets
  for each row execute function check_budget_overlap();

-- ---------- fixed_entries（固定収支マスタ）----------
create table fixed_entries (
  id           serial primary key,
  name         text not null,
  kind         entry_kind not null,
  category_id  int not null references categories(id),
  amount       int not null,
  payer        owner_type not null default '共通',
  day_of_month int not null default 1 check (day_of_month between 1 and 31),
  frequency    freq_type not null default 'monthly',
  months       int[],
  valid_from   date not null,
  valid_to     date
);

comment on table fixed_entries is
  '自動計上するのは金額が確定しているものだけ。
   ボーナス・還付金・年間支出は変動するため手入力とする。';

-- ---------- transactions（明細）----------
create table transactions (
  id               uuid primary key default gen_random_uuid(),
  occurred_on      date not null,                   -- カレンダー主体なので日付で持つ
  account_id       int not null references accounts(id),
  type             entry_kind not null,
  category_id      int references categories(id),   -- null = 未分類
  merchant         text not null default '',
  amount           int not null,                    -- 返金はマイナス
  payer            owner_type not null default '共通',
  memo             text not null default '',
  gmail_message_id text unique,
  approval_no      text,
  is_refund        boolean not null default false,
  source           tx_source not null default 'manual',
  fixed_entry_id   int references fixed_entries(id),
  period_month     date,
  created_at       timestamptz not null default now()
);

-- 承認番号は6桁で衝突しうるため、Gmailメッセージ ID を重複排除キーにする
create unique index idx_tx_fixed_once
  on transactions(fixed_entry_id, period_month)
  where fixed_entry_id is not null;

create index idx_tx_date    on transactions(occurred_on desc);
create index idx_tx_account on transactions(account_id, occurred_on);
create index idx_tx_unclassified on transactions(occurred_on) where category_id is null;

-- ---------- merchant_rules ----------
create table merchant_rules (
  id          serial primary key,
  pattern     text not null,
  category_id int not null references categories(id) on delete cascade,
  priority    int not null default 0,
  hit_count   int not null default 0
);

create unique index idx_rules_pattern on merchant_rules(upper(pattern));

-- ---------- annual_targets（年間支出の目安）----------
create table annual_targets (
  id          serial primary key,
  year        int not null,
  category_id int not null references categories(id),
  amount      int not null,
  unique (year, category_id)
);

comment on table annual_targets is
  '旅行・住民税などの目安額。予算ではなく参考値として進捗を表示する。';

-- ---------- import_errors ----------
create table import_errors (
  id               serial primary key,
  gmail_message_id text,
  subject          text,
  reason           text not null,
  raw_excerpt      text,
  created_at       timestamptz not null default now()
);

-- ---------- settings ----------
create table settings (
  key   text primary key,
  value text not null
);

-- ============================================================
-- 関数
-- ============================================================

-- 指定月に有効な予算
create or replace function fn_budgets(target_month date)
returns table (category_id int, name text, account_kind account_kind,
               is_variable boolean, amount int) as $$
  select c.id, c.name, a.kind, c.is_variable, b.amount
  from categories c
  join accounts a on a.id = c.account_id
  left join category_budgets b
    on b.category_id = c.id
   and b.valid_from <= date_trunc('month', target_month)::date
   and (b.valid_to is null or b.valid_to >= date_trunc('month', target_month)::date)
  where c.is_active;
$$ language sql stable;

-- 指定月の固定収支を計上する
create or replace function fn_generate_fixed(target_month date)
returns int as $$
declare
  inserted int;
  m date := date_trunc('month', target_month)::date;
begin
  insert into transactions
    (occurred_on, account_id, type, category_id, merchant, amount, payer,
     source, fixed_entry_id, period_month)
  select
    m + (least(f.day_of_month,
               extract(day from (m + interval '1 month' - interval '1 day'))::int) - 1),
    c.account_id, f.kind, f.category_id, f.name, f.amount, f.payer,
    'fixed', f.id, m
  from fixed_entries f
  join categories c on c.id = f.category_id
  where f.valid_from <= m
    and (f.valid_to is null or f.valid_to >= m)
    and (
      f.frequency = 'monthly'
      or (f.frequency = 'specific_months' and extract(month from m)::int = any(f.months))
      or (f.frequency = 'yearly' and extract(month from m)::int = coalesce(f.months[1], 1))
    )
  on conflict (fixed_entry_id, period_month) where fixed_entry_id is not null
  do nothing;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$ language plpgsql;

-- 指定口座の、指定月の前日までの累計（＝繰越）
create or replace function fn_carryover(target_account int, target_month date)
returns int as $$
  select coalesce(sum(case when type = '収入' then amount else -amount end), 0)::int
  from transactions
  where account_id = target_account
    and occurred_on < date_trunc('month', target_month)::date;
$$ language sql stable;

-- 口座の現在残高
create or replace function fn_balance(target_account int)
returns int as $$
  select coalesce(sum(case when type = '収入' then amount else -amount end), 0)::int
  from transactions
  where account_id = target_account;
$$ language sql stable;

-- ============================================================
-- RLS
-- ============================================================
alter table users            enable row level security;
alter table accounts         enable row level security;
alter table categories       enable row level security;
alter table category_budgets enable row level security;
alter table fixed_entries    enable row level security;
alter table transactions     enable row level security;
alter table merchant_rules   enable row level security;
alter table annual_targets   enable row level security;
alter table import_errors    enable row level security;
alter table settings         enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'users','accounts','categories','category_budgets','fixed_entries',
    'transactions','merchant_rules','annual_targets','import_errors','settings'
  ] loop
    execute format(
      'create policy "authenticated_all" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
