-- ============================================================
-- v1 のテーブルを削除する
-- v2_01_schema.sql の前に実行する
--
-- 消えるのは家計簿のデータだけで、ログインアカウント（auth.users）は残る。
-- 再ログインの設定はやり直さなくてよい。
-- ============================================================

drop function if exists fn_generate_fixed(date);
drop function if exists fn_contributions(date);
drop function if exists fn_budgets(date);
drop function if exists fn_carryover(int, date);
drop function if exists fn_balance(int);
drop function if exists check_budget_overlap() cascade;
drop function if exists touch_updated_at() cascade;

drop view if exists v_transactions;
drop view if exists v_current_budgets;

drop table if exists transactions      cascade;
drop table if exists category_budgets  cascade;
drop table if exists fixed_entries     cascade;
drop table if exists merchant_rules    cascade;
drop table if exists savings_goals     cascade;
drop table if exists annual_targets    cascade;
drop table if exists contributions     cascade;
drop table if exists categories        cascade;
drop table if exists pockets           cascade;
drop table if exists accounts          cascade;
drop table if exists import_errors     cascade;
drop table if exists settings          cascade;
drop table if exists users             cascade;

drop type if exists owner_type    cascade;
drop type if exists entry_kind    cascade;
drop type if exists tx_source     cascade;
drop type if exists pocket_kind   cascade;
drop type if exists account_kind  cascade;
drop type if exists freq_type     cascade;
drop type if exists budget_period cascade;
