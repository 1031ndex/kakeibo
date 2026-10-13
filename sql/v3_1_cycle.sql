-- ============================================================
-- 家計簿アプリ v3.1 — 25日区切り・営業日・残高合わせ
--
-- 前提: v3_final.sql を実行済み
-- 何度実行しても同じ結果になる。
--
-- 1. 家計の1か月を「25日〜翌月24日」にする（カレンダーのマスは1日始まりのまま）
--      ・選んだ月の予算は、その月の25日から始まる期間に効く
--        例: 10月の予算 → 10/25〜11/24
--      ・25日に入れる額は、その前の期間（9/25〜10/24 など）の立替を差し引く
-- 2. 自動計上を「土日祝なら翌営業日（または前営業日）」にずらせるようにする
--      家賃は翌営業日にする
-- 3. 通帳の残高と合わせる機能（差額を「残高調整」として記録する）
-- 4. 取込開始日を 9/25 にする（9/25〜9/30 のデビット利用を取り込むため）
-- ============================================================


-- ------------------------------------------------------------
-- 1. 祝日と営業日
-- ------------------------------------------------------------
-- 法則で決まらない特別な休日（即位の礼など）があれば、ここに足す
create table if not exists holidays_extra (
  day  date primary key,
  name text not null
);
alter table holidays_extra enable row level security;
do $$ begin
  create policy "authenticated_all" on holidays_extra for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- 国民の祝日（振替休日・国民の休日を除く元の祝日）
create or replace function fn_jp_holiday_base(d date)
returns boolean as $$
declare
  y   int := extract(year from d);
  m   int := extract(month from d);
  dd  int := extract(day from d);
  dow int := extract(isodow from d);      -- 1=月 … 7=日
  nth int := (dd - 1) / 7 + 1;            -- その曜日の第何回目か
  -- 春分・秋分の日（1980〜2099年に使える近似式）
  shunbun int := floor(20.8431 + 0.242194 * (y - 1980) - ((y - 1980) / 4));
  shubun  int := floor(23.2488 + 0.242194 * (y - 1980) - ((y - 1980) / 4));
begin
  return (m = 1  and dd = 1)                 -- 元日
      or (m = 1  and dow = 1 and nth = 2)    -- 成人の日（1月第2月曜）
      or (m = 2  and dd = 11)                -- 建国記念の日
      or (m = 2  and dd = 23)                -- 天皇誕生日
      or (m = 3  and dd = shunbun)           -- 春分の日
      or (m = 4  and dd = 29)                -- 昭和の日
      or (m = 5  and dd in (3, 4, 5))        -- 憲法記念日・みどりの日・こどもの日
      or (m = 7  and dow = 1 and nth = 3)    -- 海の日（7月第3月曜）
      or (m = 8  and dd = 11)                -- 山の日
      or (m = 9  and dow = 1 and nth = 3)    -- 敬老の日（9月第3月曜）
      or (m = 9  and dd = shubun)            -- 秋分の日
      or (m = 10 and dow = 1 and nth = 2)    -- スポーツの日（10月第2月曜）
      or (m = 11 and dd = 3)                 -- 文化の日
      or (m = 11 and dd = 23)                -- 勤労感謝の日
      or exists (select 1 from holidays_extra h where h.day = d);
end;
$$ language plpgsql stable;

-- 祝日（振替休日・国民の休日を含む）
create or replace function fn_jp_holiday(d date)
returns boolean as $$
declare
  k date;
begin
  if fn_jp_holiday_base(d) then return true; end if;

  -- 振替休日: 直前に続く祝日の中に日曜日があれば、その後の最初の平日は休み
  k := d - 1;
  while fn_jp_holiday_base(k) loop
    if extract(isodow from k) = 7 then return true; end if;
    k := k - 1;
  end loop;

  -- 国民の休日: 前日と翌日がどちらも祝日なら休み
  if fn_jp_holiday_base(d - 1) and fn_jp_holiday_base(d + 1) then return true; end if;

  return false;
end;
$$ language plpgsql stable;

-- 銀行が休みの日（土日・祝日・12/31・1/2・1/3）
create or replace function fn_bank_closed(d date)
returns boolean as $$
  select extract(isodow from d) in (6, 7)
      or fn_jp_holiday(d)
      or (extract(month from d) = 12 and extract(day from d) = 31)
      or (extract(month from d) = 1  and extract(day from d) in (2, 3));
$$ language sql stable;

-- 営業日にずらす。rule: none（ずらさない）/ next（翌営業日）/ prev（前営業日）
create or replace function fn_business_day(d date, rule text)
returns date as $$
declare
  r date := d;
begin
  if rule = 'next' then
    while fn_bank_closed(r) loop r := r + 1; end loop;
  elsif rule = 'prev' then
    while fn_bank_closed(r) loop r := r - 1; end loop;
  end if;
  return r;
end;
$$ language plpgsql stable;

alter table fixed_entries add column if not exists holiday_rule text not null default 'none';
do $$ begin
  alter table fixed_entries add constraint fixed_entries_holiday_rule_chk
    check (holiday_rule in ('none', 'next', 'prev'));
exception when duplicate_object then null; end $$;

comment on column fixed_entries.holiday_rule is
  '記帳日が銀行の休みの日に当たったとき: none=そのまま / next=翌営業日 / prev=前営業日';

-- 自動計上（営業日に対応）
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
    fn_business_day(
      m + (least(f.day_of_month,
                 extract(day from (m + interval '1 month' - interval '1 day'))::int) - 1),
      f.holiday_rule),
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

-- 家賃は土日祝なら翌営業日
update fixed_entries set holiday_rule = 'next'
 where category_id = (select id from categories where name = '家賃+火災保険');


-- ------------------------------------------------------------
-- 2. 残高調整
-- ------------------------------------------------------------
alter table categories add column if not exists is_system boolean not null default false;
comment on column categories.is_system is 'アプリが内部で使うカテゴリ。手入力や振り分けの選択肢に出さない';

insert into categories (name, account_id, kind, is_variable, sort_order, is_system)
values ('残高調整', 1, '収入', false, 99, true)
on conflict (name) do update set is_system = true;

-- 指定日の終わり時点の共通りそなの残高
create or replace function fn_balance_on(d date)
returns int as $$
  select coalesce(sum(case when type = '収入' then amount else -amount end), 0)::int
  from transactions
  where account_id = 1 and occurred_on <= d;
$$ language sql stable;


-- ------------------------------------------------------------
-- 3. 25日区切りの集計
-- ------------------------------------------------------------
-- 指定日の時点の、口座残高・貯蓄・使えるお金。
-- 貯蓄は、25日の入金が入るたびに「その月の貯蓄額」だけ積み上がる。
create or replace function fn_money_at(end_date date)
returns table (
  balance int,       -- 共通りそなの残高（予定されている自動計上を含む）
  monthly_plan int,  -- この期間の貯蓄額
  saved int,         -- これまでに貯めた額（毎月の貯蓄＋ボーナス・還付金）
  used int,          -- これまでの年間支出
  savings int,       -- 貯蓄の残り
  spendable int      -- 使えるお金 = 残高 − 貯蓄の残り
) as $$
  with conf as (
    select coalesce((select value::date from settings where key = 'start_month'),
                    date '2026-10-01') as started,
           -- end_date が属する期間の、始まりの月（25日以降ならその月、24日以前なら前月）
           (date_trunc('month', end_date)
             - case when extract(day from end_date) >= 25 then interval '0' else interval '1 month' end
           )::date as cycle_month
  ),
  plan as (
    select coalesce(sum(fn_savings_plan(g::date)), 0)::int as total
      from conf, generate_series(conf.started, conf.cycle_month, interval '1 month') g
  ),
  extra as (
    select coalesce(sum(t.amount), 0)::int as total
      from transactions t join categories c on c.id = t.category_id
     where c.is_savings_income and t.type = '収入' and t.occurred_on <= end_date
  ),
  usd as (
    select coalesce(sum(t.amount), 0)::int as total
      from transactions t join categories c on c.id = t.category_id
     where c.is_annual and t.type = '支出' and t.occurred_on <= end_date
  )
  select fn_balance_on(end_date),
         case when conf.cycle_month >= conf.started then fn_savings_plan(conf.cycle_month) else 0 end,
         plan.total + extra.total,
         usd.total,
         plan.total + extra.total - usd.total,
         fn_balance_on(end_date) - greatest(0, plan.total + extra.total - usd.total)
  from conf, plan, extra, usd;
$$ language sql stable;

comment on function fn_money_at is
  '口座は1つだが、アプリ上は生活費と貯蓄に分けて見せる。期間の締め日（24日）を渡すと、その期間の終わりの見込みが出る。';

-- 精算: target_month の25日に入れる額
--   = 拠出 − 前の期間（前月25日〜当月24日）に本人が立て替えた額 − その月の誕生日プレゼント
create or replace function fn_settlement(target_month date)
returns table (user_name owner_type, base_amount int, advanced int, to_pay int) as $$
  with m as (
    select date_trunc('month', target_month)::date as ms,
           (date_trunc('month', target_month) - interval '1 month' + interval '24 days')::date as from_day,
           (date_trunc('month', target_month) + interval '23 days')::date as to_day
  ),
  base as (
    select u.name, coalesce(sum(f.amount), 0)::int as amount
      from users u
      cross join m
      left join fixed_entries f
        on f.payer = u.name
       and f.kind = '収入'
       and f.category_id in (select id from categories where is_contribution)
       and f.valid_from <= m.ms
       and (f.valid_to is null or f.valid_to >= m.ms)
     where u.is_active
     group by u.name
  ),
  adv as (
    select t.payer, sum(t.amount)::int as total
      from transactions t
      cross join m
     where t.account_id = 1
       and t.type = '支出'
       and t.payer <> '共通'
       and (
         (t.source <> 'fixed' and t.occurred_on between m.from_day and m.to_day)
         or (t.source = 'fixed' and t.period_month = m.ms)
       )
     group by t.payer
  )
  select b.name, b.amount, coalesce(a.total, 0), (b.amount - coalesce(a.total, 0))::int
    from base b
    left join adv a on a.payer = b.name
   order by b.name;
$$ language sql stable;

-- 推移グラフ: 25日〜翌月24日でまとめる。month は締めの月（9/25〜10/24 → 10月）
create or replace function fn_monthly_trend(target_account int, months_back int default 12)
returns table (month date, income int, outgo int) as $$
  with t as (
    select (date_trunc('month', occurred_on)
             + case when extract(day from occurred_on) >= 25 then interval '1 month' else interval '0' end
           )::date as month,
           type, amount
      from transactions
     where account_id = target_account
  )
  select month,
         sum(case when type = '収入' then amount else 0 end)::int,
         sum(case when type = '支出' then amount else 0 end)::int
    from t
   where month >= (date_trunc('month', current_date) - (months_back || ' months')::interval)::date
     -- 先の月の自動計上（予定）は含めない
     and month <= (date_trunc('month', current_date)
                   + case when extract(day from current_date) >= 25 then interval '1 month' else interval '0' end)::date
   group by month
   order by month;
$$ language sql stable;


-- ------------------------------------------------------------
-- 4. 取込開始日を 9/25 にする
-- ------------------------------------------------------------
-- 9/25〜9/30 のデビット利用を取り込むため。これより前は取り込まない。
update settings set value = '2026-09-25' where key = 'import_from';


-- ------------------------------------------------------------
-- 5. 営業日の設定に合わせて、これからの自動計上を作り直す
-- ------------------------------------------------------------
delete from transactions t
 using fixed_entries f
 where t.fixed_entry_id = f.id
   and f.holiday_rule <> 'none'
   and t.occurred_on >= current_date;

select fn_generate_until(greatest(date '2026-10-01', date_trunc('month', current_date)::date));


-- ------------------------------------------------------------
-- 6. 確認
-- ------------------------------------------------------------
select '2026年の祝日' as 項目,
       string_agg(to_char(d, 'MM/DD'), ' ') as 内容
  from generate_series(date '2026-01-01', date '2026-12-31', interval '1 day') g(d)
 where fn_jp_holiday(d::date)
union all
select '家賃の引落日（今後12か月）',
       string_agg(to_char(fn_business_day(
         (date_trunc('month', current_date) + (n || ' months')::interval + interval '27 days')::date, 'next'),
         'YY/MM/DD (Dy)'), '  ')
  from generate_series(0, 11) n
union all
select '10/25に入れる額', string_agg(user_name || ' ' || to_pay, ' / ')
  from fn_settlement(date '2026-10-01');
