-- ============================================================
-- 誕生日プレゼントの月を直す
--
-- 逆に組んでいたため、正しい組み合わせにする。
--   りほ → ゆうき（10/31）: りほが 9月25日 の入金から10万円差し引く
--   ゆうき → りほ（10/3） : ゆうきが 8月25日 の入金から10万円差し引く
--
-- 2026年は、りほの分は 9/25 にすでに済んでいる（アプリを始める前）ため、
-- 10/25 に入れていた「誕生日プレゼント（りほ→ゆうき・2026）」は消す。
-- これで 10/25 にりほが入れる額は 192,000 に戻る。
--
-- v3_final / v3_1 のどちらのあとに流してもよい。何度流しても同じ結果になる。
-- ============================================================

-- 2026年10月に入れていた分を消す
delete from transactions
 where fixed_entry_id in (select id from fixed_entries
                           where name = '誕生日プレゼント（りほ→ゆうき・2026）');
delete from fixed_entries where name = '誕生日プレゼント（りほ→ゆうき・2026）';

-- 2027年以降の月を入れ替える（作り済みの記帳があれば消して作り直させる）
delete from transactions
 where fixed_entry_id in (select id from fixed_entries
                           where name in ('誕生日プレゼント（りほ→ゆうき）', '誕生日プレゼント（ゆうき→りほ）'));
update fixed_entries set months = array[9] where name = '誕生日プレゼント（りほ→ゆうき）';
update fixed_entries set months = array[8] where name = '誕生日プレゼント（ゆうき→りほ）';

-- 2026年の誕生日分はアプリの外で済んでいるので、目安を0にする
update annual_targets set amount = 0
 where year = 2026
   and category_id = (select id from categories where name = '誕生日プレゼント');

-- 確認
select '10/25 にりほが入れる額' as 項目, to_pay::text as 内容, '192000' as 正しい値
  from fn_settlement(date '2026-10-01') where user_name = 'りほ'
union all
select name, months[1] || '月25日に差し引く',
       case when name like '%りほ→ゆうき%' then '9月25日に差し引く' else '8月25日に差し引く' end
  from fixed_entries where name like '誕生日プレゼント%';
