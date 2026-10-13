-- ============================================================
-- 家計簿アプリ v3 — 最終版への移行
--
-- 前提: v2_00 〜 v2_03 を実行済み（今の状態）
-- 何度実行しても同じ結果になるように書いてある。途中で止まっても再実行してよい。
--
-- このファイルでやること
--   1. 貯蓄口座を廃止し、共通りそな1つにまとめる
--   2. 拠出額を変更（貯蓄分を上乗せ）
--        りほ   192,000（10月〜）
--        ゆうき 157,000（10月のみ）→ 134,000（11月〜。差額23,000はNISAへ）
--   3. ゆうきのNISA 23,000 を運用資産に追加（11月〜）
--   4. 誕生日プレゼント（10万円ずつ）
--        りほ→ゆうき（10/31）: りほが9月の拠出から差し引く
--        ゆうき→りほ（10/3） : ゆうきが8月の拠出から差し引く
--        2026年分はアプリを始める前に済んでいるので、2027年から
--   5. 「今月使えるお金」と貯蓄の計算を作り直す
--
-- 【毎月の貯蓄額は自動で決まる】
--   毎月の貯蓄 = 拠出の合計 − 生活費の予算（家賃＋変動費）
--     10月: 349,000 − 249,000 = 100,000
--     11月: 326,000 − 249,000 =  77,000
--   拠出や予算を設定画面で変えれば、貯蓄額もその月から自動で変わる。
--   過去の月は当時の金額のまま。
--
--   ボーナス・還付金は貯蓄に入る。旅行・住民税・誕生日などの年間支出は貯蓄から出る。
-- ============================================================


-- ------------------------------------------------------------
-- 1. カテゴリに役割のフラグを持たせる
-- ------------------------------------------------------------
alter table categories add column if not exists is_annual         boolean not null default false;
alter table categories add column if not exists is_contribution   boolean not null default false;
alter table categories add column if not exists is_savings_income boolean not null default false;

comment on column categories.is_annual is '年間支出。貯蓄から出ていく（旅行・住民税・誕生日など）';
comment on column categories.is_contribution is '拠出。2人が毎月共通りそなに入れるお金';
comment on column categories.is_savings_income is '貯蓄に入る収入（ボーナス・還付金）';


-- ------------------------------------------------------------
-- 2. 貯蓄口座を共通りそなに統合
-- ------------------------------------------------------------
-- 貯蓄口座の記帳は10月の積立2件のみ。口座を1つにするので消す。
delete from transactions where account_id = 2;

-- 年間支出・ボーナス・還付金などのカテゴリを共通りそなへ移す
update categories set account_id = 1 where account_id = 2;
update accounts set name = '貯蓄（廃止）' where id = 2;

-- 「積立」は口座間の移動を表していたが、口座が1つになったので不要
delete from transactions
 where fixed_entry_id in (
   select f.id from fixed_entries f join categories c on c.id = f.category_id
    where c.name in ('積立（りほ）', '積立（ゆうき）'));
delete from fixed_entries
 where category_id in (select id from categories where name in ('積立（りほ）', '積立（ゆうき）'));
delete from category_budgets
 where category_id in (select id from categories where name in ('積立（りほ）', '積立（ゆうき）'));
update categories set is_active = false where name in ('積立（りほ）', '積立（ゆうき）');


-- ------------------------------------------------------------
-- 3. カテゴリの追加とフラグ付け
-- ------------------------------------------------------------
insert into categories (name, account_id, kind, is_variable, sort_order)
values ('誕生日プレゼント', 1, '支出', false, 38)
on conflict (name) do nothing;

insert into categories (name, account_id, kind, is_variable, sort_order)
values ('NISA（ゆうき）', 3, '収入', false, 43)
on conflict (name) do nothing;

update categories set is_annual = true
 where name in ('旅行', '住民税（りほ）', '娯楽（年間）', '医療費', 'ふるさと納税',
                'イベント', '住まいのもの', '税理士', '誕生日プレゼント');

update categories set is_contribution = true
 where name in ('拠出（りほ）', '拠出（ゆうき）');

update categories set is_savings_income = true
 where name in ('ボーナス', '還付金');


-- ------------------------------------------------------------
-- 4. 拠出・NISA・誕生日の固定収支と予算を作り直す
-- ------------------------------------------------------------
-- いったん消して入れ直す（再実行しても二重にならないように）
delete from transactions
 where fixed_entry_id in (
   select f.id from fixed_entries f join categories c on c.id = f.category_id
    where c.name in ('拠出（りほ）', '拠出（ゆうき）', 'NISA（ゆうき）', '誕生日プレゼント'));
delete from fixed_entries
 where category_id in (select id from categories
                        where name in ('拠出（りほ）', '拠出（ゆうき）', 'NISA（ゆうき）', '誕生日プレゼント'));
delete from category_budgets
 where category_id in (select id from categories
                        where name in ('拠出（りほ）', '拠出（ゆうき）', 'NISA（ゆうき）'));

-- 予算（期間つき）
insert into category_budgets (category_id, amount, valid_from, valid_to)
select c.id, v.amt, v.f::date, v.t::date
from (values
  ('拠出（りほ）',   192000, '2026-10-01', null),
  ('拠出（ゆうき）', 157000, '2026-10-01', '2026-10-31'),
  ('拠出（ゆうき）', 134000, '2026-11-01', null),
  ('NISA（ゆうき）',  23000, '2026-11-01', null)
) as v(nm, amt, f, t)
join categories c on c.name = v.nm;

-- 自動計上（期間つき）
insert into fixed_entries (name, kind, category_id, amount, payer, day_of_month,
                           frequency, months, valid_from, valid_to)
select v.nm, v.knd::entry_kind, c.id, v.amt, v.payer::owner_type, v.dom,
       v.freq::freq_type, v.mons, v.f::date, v.t::date
from (values
  -- 拠出（毎月25日）
  ('拠出（りほ）',   '拠出（りほ）',   '収入', 192000, 'りほ',   25, 'monthly', null::int[], '2026-10-01', null),
  ('拠出（ゆうき）', '拠出（ゆうき）', '収入', 157000, 'ゆうき', 25, 'monthly', null::int[], '2026-10-01', '2026-10-31'),
  ('拠出（ゆうき）', '拠出（ゆうき）', '収入', 134000, 'ゆうき', 25, 'monthly', null::int[], '2026-11-01', null),
  -- NISA（ゆうきの給与口座から。運用資産）
  ('NISA（ゆうき）', 'NISA（ゆうき）', '収入',  23000, 'ゆうき',  1, 'monthly', null::int[], '2026-11-01', null),
  -- 誕生日プレゼント。支払者を本人にすると、その月の拠出から自動で差し引かれる
  ('誕生日プレゼント（りほ→ゆうき）', '誕生日プレゼント', '支出', 100000, 'りほ',   25, 'specific_months', array[9], '2027-01-01', null),
  ('誕生日プレゼント（ゆうき→りほ）', '誕生日プレゼント', '支出', 100000, 'ゆうき', 25, 'specific_months', array[8], '2027-01-01', null)
) as v(nm, cat, knd, amt, payer, dom, freq, mons, f, t)
join categories c on c.name = v.cat;


-- ------------------------------------------------------------
-- 5. 年間支出の目安
-- ------------------------------------------------------------
-- イベント132,000に含まれていた誕生日50,000を抜き、誕生日プレゼントを独立させる
update annual_targets set amount = 82000
 where category_id = (select id from categories where name = 'イベント');

insert into annual_targets (year, category_id, amount)
select v.y, c.id, v.amt
from (values (2026, 0), (2027, 200000)) as v(y, amt)
join categories c on c.name = '誕生日プレゼント'
on conflict (year, category_id) do update set amount = excluded.amount;


-- ------------------------------------------------------------
-- 6. 関数
-- ------------------------------------------------------------
-- 旧版で使っていたもの
drop function if exists fn_spendable(date);
drop function if exists fn_savings_status(int);
delete from settings where key = 'savings_per_month';

-- 指定月に有効な予算と、その先に予約されている変更
drop function if exists fn_budgets(date);
create function fn_budgets(target_month date)
returns table (
  category_id int, name text, account_kind account_kind, kind entry_kind,
  is_variable boolean, is_annual boolean, is_contribution boolean,
  amount int, next_amount int, next_from date
) as $$
  select c.id, c.name, a.kind, c.kind,
         c.is_variable, c.is_annual, c.is_contribution,
         b.amount, nx.amount, nx.valid_from
  from categories c
  join accounts a on a.id = c.account_id
  left join category_budgets b
    on b.category_id = c.id
   and b.valid_from <= date_trunc('month', target_month)::date
   and (b.valid_to is null or b.valid_to >= date_trunc('month', target_month)::date)
  left join lateral (
    select b2.amount, b2.valid_from
      from category_budgets b2
     where b2.category_id = c.id
       and b2.valid_from > date_trunc('month', target_month)::date
     order by b2.valid_from
     limit 1
  ) nx on true
  where c.is_active
  order by c.sort_order;
$$ language sql stable;

-- その月の貯蓄額 = 拠出の合計 − 生活費の予算
create or replace function fn_savings_plan(target_month date)
returns int as $$
  select coalesce(sum(
           case when c.is_contribution then b.amount
                when c.kind = '支出' and not c.is_annual then -b.amount
                else 0 end), 0)::int
  from categories c
  join category_budgets b on b.category_id = c.id
  where c.account_id = 1
    and c.is_active
    and b.valid_from <= date_trunc('month', target_month)::date
    and (b.valid_to is null or b.valid_to >= date_trunc('month', target_month)::date);
$$ language sql stable;

-- 指定月の月末時点の、口座残高・貯蓄・使えるお金
create or replace function fn_money(target_month date)
returns table (
  balance int,       -- 共通りそなの残高
  monthly_plan int,  -- その月の貯蓄額
  saved int,         -- これまでに貯めた額（毎月の貯蓄＋ボーナス・還付金）
  used int,          -- これまでの年間支出
  savings int,       -- 貯蓄の残り（マイナスなら年間支出が貯蓄を上回っている）
  spendable int      -- 使えるお金 = 残高 − 貯蓄の残り
) as $$
  with conf as (
    select coalesce((select value::date from settings where key = 'start_month'),
                    date '2026-10-01') as started,
           date_trunc('month', target_month)::date as ms,
           (date_trunc('month', target_month) + interval '1 month' - interval '1 day')::date as me
  ),
  plan as (
    select coalesce(sum(fn_savings_plan(g::date)), 0)::int as total
      from conf, generate_series(conf.started, conf.ms, interval '1 month') g
  ),
  extra as (
    select coalesce(sum(t.amount), 0)::int as total
      from transactions t
      join categories c on c.id = t.category_id
      cross join conf
     where c.is_savings_income and t.type = '収入' and t.occurred_on <= conf.me
  ),
  usd as (
    select coalesce(sum(t.amount), 0)::int as total
      from transactions t
      join categories c on c.id = t.category_id
      cross join conf
     where c.is_annual and t.type = '支出' and t.occurred_on <= conf.me
  ),
  bal as (
    select coalesce(sum(case when t.type = '収入' then t.amount else -t.amount end), 0)::int as total
      from transactions t
      cross join conf
     where t.account_id = 1 and t.occurred_on <= conf.me
  )
  select bal.total,
         fn_savings_plan(conf.ms),
         plan.total + extra.total,
         usd.total,
         plan.total + extra.total - usd.total,
         bal.total - greatest(0, plan.total + extra.total - usd.total)
  from conf, plan, extra, usd, bal;
$$ language sql stable;

comment on function fn_money is
  '口座は1つだが、アプリ上は生活費と貯蓄に分けて見せる。
   通帳の残高には貯蓄分が混ざっているため、差し引いた「使えるお金」を出す。';

-- 精算: その月に共通りそなへ入れる額 = 拠出 − 本人が払った共通の支出
create or replace function fn_settlement(target_month date)
returns table (user_name owner_type, base_amount int, advanced int, to_pay int) as $$
  with m as (
    select date_trunc('month', target_month)::date as ms,
           (date_trunc('month', target_month) + interval '1 month' - interval '1 day')::date as me
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
       and t.occurred_on between m.ms and m.me
     group by t.payer
  )
  select b.name, b.amount, coalesce(a.total, 0), (b.amount - coalesce(a.total, 0))::int
    from base b
    left join adv a on a.payer = b.name
   order by b.name;
$$ language sql stable;

comment on function fn_settlement is
  '本人が払った共通の支出（立替・誕生日プレゼント）は、その月の拠出から差し引く。';


-- 運用開始月から指定月までの固定収支をまとめて計上する。
-- 月を飛ばして先の月を開いても、間の月の拠出や家賃が抜けないようにするため。
create or replace function fn_generate_until(target_month date)
returns int as $$
declare
  total int := 0;
  m date;
  started date := coalesce((select value::date from settings where key = 'start_month'),
                           date '2026-10-01');
begin
  for m in
    select g::date from generate_series(started, date_trunc('month', target_month)::date,
                                        interval '1 month') g
  loop
    total := total + fn_generate_fixed(m);
  end loop;
  return total;
end;
$$ language plpgsql;


-- ------------------------------------------------------------
-- 7. 今月分までを計上
-- ------------------------------------------------------------
select fn_generate_until(greatest(date '2026-10-01', date_trunc('month', current_date)::date));


-- ------------------------------------------------------------
-- 8. 確認（この表が出れば成功）
-- ------------------------------------------------------------
select '10月の貯蓄額' as 確認項目, fn_savings_plan(date '2026-10-01') as 金額, 100000 as 正しい値
union all
select '11月の貯蓄額', fn_savings_plan(date '2026-11-01'), 77000
union all
select '10月 りほが入れる額',
       (select to_pay from fn_settlement(date '2026-10-01') where user_name = 'りほ'), 192000
union all
select '10月 ゆうきが入れる額',
       (select to_pay from fn_settlement(date '2026-10-01') where user_name = 'ゆうき'), 157000
union all
select '11月 ゆうきが入れる額',
       (select base_amount from fn_settlement(date '2026-11-01') where user_name = 'ゆうき'), 134000;
