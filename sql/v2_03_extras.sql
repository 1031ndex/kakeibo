-- ============================================================
-- 家計簿アプリ v2.1 追加分
-- v2_02_seed.sql を実行済みのプロジェクトに流す
-- ============================================================

-- ---------- 取込制御の設定 ----------
insert into settings (key, value) values
  ('import_enabled', 'true'),      -- false にすると GAS は何もせず終了する
  ('import_from',    '2026-10-01') -- この日より前のメールは取り込まない
on conflict (key) do nothing;

-- ---------- 設定の更新用 ----------
create or replace function fn_set_setting(k text, v text)
returns void as $$
  insert into settings (key, value) values (k, v)
  on conflict (key) do update set value = excluded.value;
$$ language sql;

-- ---------- 立替の集計 ----------
-- 共通りそなの支出のうち、支払者がりほ／ゆうきのもの＝立替。
-- 貯蓄口座の年間支出は精算対象外なので含めない。
create or replace function fn_settlement(target_month date)
returns table (user_name owner_type, base_amount int, advanced int, to_pay int) as $$
  with m as (
    select date_trunc('month', target_month)::date as ms,
           (date_trunc('month', target_month) + interval '1 month' - interval '1 day')::date as me
  ),
  base as (
    select u.name,
           coalesce((
             select b.amount
             from categories c
             join category_budgets b on b.category_id = c.id
             cross join m
             where c.name = '拠出（' || u.name::text || '）'
               and b.valid_from <= m.ms
               and (b.valid_to is null or b.valid_to >= m.ms)
             limit 1
           ), 0) as amount
    from users u
    where u.is_active
  ),
  adv as (
    select t.payer, sum(t.amount)::int as total
    from transactions t
    cross join m
    where t.account_id = 1
      and t.type = '支出'
      and t.payer <> '共通'
      and t.occurred_on between m.ms and m.me
    group by t.payer
  )
  select b.name, b.amount,
         coalesce(a.total, 0),
         (b.amount - coalesce(a.total, 0))::int
  from base b
  left join adv a on a.payer = b.name;
$$ language sql stable;

comment on function fn_settlement is
  '拠出額は「基準額 − その人が立て替えた額」。
   立て替えた分はすでに本人が払っているため、その月の入金を減らして精算する。';

-- ---------- 月次推移（グラフ用）----------
create or replace function fn_monthly_trend(target_account int, months_back int default 12)
returns table (month date, income int, outgo int) as $$
  select
    date_trunc('month', occurred_on)::date as month,
    sum(case when type = '収入' then amount else 0 end)::int,
    sum(case when type = '支出' then amount else 0 end)::int
  from transactions
  where account_id = target_account
    and occurred_on >= (date_trunc('month', current_date) - (months_back || ' months')::interval)::date
  group by 1
  order by 1;
$$ language sql stable;
