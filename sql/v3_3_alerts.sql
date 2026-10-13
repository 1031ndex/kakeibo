-- ============================================================
-- 家計簿アプリ v3.3 — アラート（アプリ内・LINE）
--
-- 前提: v3_1_cycle.sql, v3_2_birthday_fix.sql を実行済み
-- 何度実行しても同じ結果になる。
--
-- 【通知するもの】期間は25日〜翌月24日
--   ペース    : 期間の経過より早く使っていて、このままだとオーバーしそう
--   予算80%   : 変動費が予算の80%を超えた
--   予算超過  : 変動費が予算を超えた（これが出たら80%は出さない）
--   カテゴリ  : 食費・外食などが、それぞれの予算を超えた
--   使えるお金: 24日までに使えるお金が基準を切った
--   貯蓄不足  : 年間支出が貯蓄を上回った
--   入金      : 24日の20時に、明日入れる額
--
-- 【繰り返さない】
--   同じ通知は1つの期間に1回だけ。alerts.alert_key を一意にして二重に作らない。
--
-- 【送り方】
--   判定は取込のたび（毎時・更新ボタン）と、アプリを開いたとき。
--   アプリ内にはすぐ出る。LINEへはGASが送る（夜23時〜朝7時は朝にまとめる設定あり）。
-- ============================================================


-- ------------------------------------------------------------
-- 1. テーブル
-- ------------------------------------------------------------
create table if not exists alerts (
  id          serial primary key,
  alert_key   text not null unique,   -- 例 'pace:2026-10'。同じキーは二度作らない
  kind        text not null,
  title       text not null,
  body        text not null,
  cycle_month date,                   -- どの期間の通知か（期間の始まりの月）
  created_at  timestamptz not null default now(),
  sent_at     timestamptz             -- LINEに送った時刻。送っていなければ null
);

-- 誰が読んだか（2人それぞれに既読を持つ）
create table if not exists alert_reads (
  alert_id int  not null references alerts(id) on delete cascade,
  user_id  uuid not null,
  read_at  timestamptz not null default now(),
  primary key (alert_id, user_id)
);

alter table alerts      enable row level security;
alter table alert_reads enable row level security;
do $$ begin
  create policy "authenticated_all" on alerts for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "authenticated_all" on alert_reads for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;


-- ------------------------------------------------------------
-- 2. 設定（アプリの設定タブから変えられる）
-- ------------------------------------------------------------
insert into settings (key, value) values
  ('alerts_enabled',        'true'),   -- 通知全体のオン・オフ
  ('line_enabled',          'true'),   -- LINEに送るか
  ('alert_quiet_night',     'true'),   -- 夜23時〜朝7時は送らず朝7時にまとめる
  ('alert_pace_points',     '15'),     -- 期間の経過より何ポイント早ければ警告するか
  ('alert_pace_min_over',   '5000'),   -- 見込みのオーバーがこの額以上なら警告
  ('alert_pace_min_days',   '5'),      -- 期間の最初の何日かは警告しない（買いだめで誤報しないように）
  ('alert_budget_rate',     '80'),     -- 予算の何%で知らせるか
  ('alert_spendable_min',   '20000'),  -- 使えるお金がこの額を切ったら知らせる
  ('alert_deposit_hour',    '20'),     -- 24日の何時に入金のお知らせを出すか
  ('line_group',            '')        -- LINEグループの登録状態（GASが書き込む）
on conflict (key) do nothing;


-- ------------------------------------------------------------
-- 3. 文面用の小さな関数
-- ------------------------------------------------------------
create or replace function fn_yen(n numeric)
returns text as $$
  select to_char(round(n), 'FM999,999,999,990');
$$ language sql immutable;

create or replace function fn_md(d date)
returns text as $$
  select to_char(d, 'FMMM/FMDD');
$$ language sql immutable;

create or replace function fn_setting_int(k text, fallback int)
returns int as $$
  select coalesce((select nullif(value, '')::int from settings where key = k), fallback);
$$ language sql stable;


-- ------------------------------------------------------------
-- 4. 判定
-- ------------------------------------------------------------
-- as_of は確かめるとき用。普段は省略して今の時刻で判定する
drop function if exists fn_check_alerts();
create or replace function fn_check_alerts(as_of timestamptz default now())
returns int as $$
declare
  now_jst   timestamp := as_of at time zone 'Asia/Tokyo';
  today     date := (as_of at time zone 'Asia/Tokyo')::date;
  ck        date;   -- 今の期間の始まりの月
  cs        date;   -- 期間の初日（25日）
  ce        date;   -- 期間の最終日（翌月24日）
  ckey      text;
  total_days int;
  passed     int;
  left_days  int;
  budget_month date;
  budget    int;
  used      int;
  rate      int;
  over_proj int;
  mo        record;
  r         record;
  n         int := 0;
  added     int;
begin
  if coalesce((select value from settings where key = 'alerts_enabled'), 'true') = 'false' then
    return 0;
  end if;

  ck := (date_trunc('month', today)
          - case when extract(day from today) >= 25 then interval '0' else interval '1 month' end)::date;
  cs := ck + 24;
  ce := (ck + interval '1 month')::date + 23;
  ckey := to_char(ck, 'YYYY-MM');
  total_days := ce - cs + 1;
  passed := today - cs + 1;
  left_days := ce - today + 1;

  -- 変動費の予算（期間の始まりの月。運用開始前の期間なら翌月のもの）
  budget_month := ck;
  select coalesce(sum(b.amount), 0) into budget from fn_budgets(budget_month) b where b.is_variable;
  if budget = 0 then
    budget_month := (ck + interval '1 month')::date;
    select coalesce(sum(b.amount), 0) into budget from fn_budgets(budget_month) b where b.is_variable;
  end if;

  select coalesce(sum(t.amount), 0) into used
    from transactions t join categories c on c.id = t.category_id
   where t.account_id = 1 and t.type = '支出' and c.is_variable
     and t.occurred_on between cs and ce;

  if budget > 0 then
    rate := floor(used * 100.0 / budget);

    -- 予算超過 / 80%
    if used > budget then
      insert into alerts (alert_key, kind, title, body, cycle_month)
      values ('budget100:' || ckey, 'budget100', '変動費が予算を超えました',
              fn_yen(used) || ' / ' || fn_yen(budget) || '円（' || fn_yen(used - budget) || '円オーバー）' || E'\n' ||
              'オーバーした分は「使えるお金」から減ります。', ck)
      on conflict (alert_key) do nothing;
      get diagnostics added = row_count; n := n + added;

    elsif rate >= fn_setting_int('alert_budget_rate', 80) then
      insert into alerts (alert_key, kind, title, body, cycle_month)
      values ('budget80:' || ckey, 'budget80',
              '変動費が予算の' || fn_setting_int('alert_budget_rate', 80) || '%を超えました',
              fn_yen(used) || ' / ' || fn_yen(budget) || '円　残り' || fn_yen(budget - used) || '円' || E'\n' ||
              fn_md(ce) || 'まであと' || left_days || '日（1日あたり' ||
              fn_yen((budget - used)::numeric / greatest(left_days, 1)) || '円）', ck)
      on conflict (alert_key) do nothing;
      get diagnostics added = row_count; n := n + added;
    end if;

    -- ペース（すでに超えている期間は出さない）
    if used <= budget
       and passed >= fn_setting_int('alert_pace_min_days', 5)
       and passed < total_days then
      over_proj := round(used::numeric * total_days / passed - budget);
      if used * 100.0 / budget >= passed * 100.0 / total_days + fn_setting_int('alert_pace_points', 15)
         and over_proj >= fn_setting_int('alert_pace_min_over', 5000) then
        insert into alerts (alert_key, kind, title, body, cycle_month)
        values ('pace:' || ckey, 'pace', '使うペースが早めです',
                '変動費 ' || fn_yen(used) || ' / ' || fn_yen(budget) || '円（' || rate || '%）' || E'\n' ||
                '期間は' || floor(passed * 100.0 / total_days) || '%経過（' || fn_md(cs) || '〜' || fn_md(ce) || '）' || E'\n' ||
                'このままだと' || fn_md(ce) || 'に約' || fn_yen(over_proj) || '円オーバーします。' || E'\n' ||
                'あと' || left_days || '日、1日' || fn_yen((budget - used)::numeric / greatest(left_days, 1)) ||
                '円までなら予算内です。', ck)
        on conflict (alert_key) do nothing;
        get diagnostics added = row_count; n := n + added;
      end if;
    end if;
  end if;

  -- カテゴリごとのオーバー
  for r in
    select b.category_id, b.name, b.amount as budget,
           coalesce((select sum(t.amount) from transactions t
                      where t.category_id = b.category_id and t.type = '支出'
                        and t.occurred_on between cs and ce), 0)::int as used
      from fn_budgets(budget_month) b
     where b.is_variable and coalesce(b.amount, 0) > 0
  loop
    if r.used > r.budget then
      insert into alerts (alert_key, kind, title, body, cycle_month)
      values ('cat:' || r.category_id || ':' || ckey, 'category', r.name || 'が予算を超えました',
              fn_yen(r.used) || ' / ' || fn_yen(r.budget) || '円（' || fn_yen(r.used - r.budget) || '円オーバー）', ck)
      on conflict (alert_key) do nothing;
      get diagnostics added = row_count; n := n + added;
    end if;
  end loop;

  -- 使えるお金・貯蓄
  select * into mo from fn_money_at(ce);

  if mo.spendable < fn_setting_int('alert_spendable_min', 20000) then
    insert into alerts (alert_key, kind, title, body, cycle_month)
    values ('spendable:' || ckey, 'spendable',
            fn_md(ce) || 'までに使えるお金が' || fn_yen(fn_setting_int('alert_spendable_min', 20000)) || '円を切りました',
            '残り' || fn_yen(mo.spendable) || '円（あと' || left_days || '日）', ck)
    on conflict (alert_key) do nothing;
    get diagnostics added = row_count; n := n + added;
  end if;

  if mo.savings < 0 then
    insert into alerts (alert_key, kind, title, body, cycle_month)
    values ('savings:' || ckey, 'savings', '年間支出が貯蓄を上回っています',
            '貯蓄の残り：' || fn_yen(mo.savings) || '円' || E'\n' ||
            '旅行・誕生日などで貯蓄より多く使っていて、この分は生活費から出ている状態です。', ck)
    on conflict (alert_key) do nothing;
    get diagnostics added = row_count; n := n + added;
  end if;

  -- 明日の入金（24日の20時以降）
  if extract(day from today) = 24
     and extract(hour from now_jst) >= fn_setting_int('alert_deposit_hour', 20) then
    insert into alerts (alert_key, kind, title, body, cycle_month)
    select 'deposit:' || to_char(today, 'YYYY-MM'), 'deposit',
           '明日' || fn_md(today + 1) || 'は入金日です',
           string_agg(
             s.user_name || '　' ||
             case when s.to_pay >= 0
                  then fn_yen(s.to_pay) || '円' ||
                       case when s.advanced <> 0 then '（' || fn_yen(s.advanced) || '円 差し引き済み）' else '' end
                  else '入金なし（共通りそなから ' || fn_yen(-s.to_pay) || '円 を受け取る）'
             end,
             E'\n' order by s.user_name),
           ck
      from fn_settlement(date_trunc('month', today)::date) s
    having count(*) > 0
    on conflict (alert_key) do nothing;
    get diagnostics added = row_count; n := n + added;
  end if;

  return n;
end;
$$ language plpgsql;

comment on function fn_check_alerts is
  '今の期間（25日〜24日）について通知の条件を調べ、新しく満たしたものだけ alerts に入れる。戻り値は新しく入れた件数。';


-- ------------------------------------------------------------
-- 5. 確認（今の状態で通知を作ってみる）
-- ------------------------------------------------------------
select fn_check_alerts() as 新しくできた通知;
select kind as 種類, title as 件名, replace(body, E'\n', ' / ') as 内容
  from alerts order by id desc limit 10;
