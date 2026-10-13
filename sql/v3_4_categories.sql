-- ============================================================
-- 家計簿 v3.4 — カテゴリ・自動計上・年間支出をアプリで編集できるようにする
--
-- アプリでカテゴリを「やめる」と is_active が false になる。
-- 今までの貯蓄額の計算は is_active のカテゴリだけを見ていたため、
-- やめたカテゴリの予算が過去の月からも消え、過去の貯蓄額が変わってしまう。
-- 予算は期間つきで持っているので、is_active を見ずに期間だけで計算するように直す。
--
-- 何度流しても同じ結果になる。
-- ============================================================

create or replace function fn_savings_plan(target_month date)
returns int as $$
  select coalesce(sum(
           case when c.is_contribution then b.amount
                when c.kind = '支出' and not c.is_annual then -b.amount
                else 0 end), 0)::int
  from categories c
  join category_budgets b on b.category_id = c.id
  where c.account_id = 1
    and b.valid_from <= date_trunc('month', target_month)::date
    and (b.valid_to is null or b.valid_to >= date_trunc('month', target_month)::date);
$$ language sql stable;

-- 確認：設定 → 予算 の「今月の貯蓄額」と同じ考え方の数字。
-- 10/25〜 が 約100,000、11/25〜 が 約77,000（娯楽・買い物を減らした分だけ多い）なら OK
select '10/25〜11/24 の貯蓄額' as 項目, fn_savings_plan(date '2026-10-01') as 金額
union all
select '11/25〜12/24 の貯蓄額', fn_savings_plan(date '2026-11-01');
