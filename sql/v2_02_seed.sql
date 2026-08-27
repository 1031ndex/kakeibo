-- ============================================================
-- 家計簿アプリ v2.0 初期マスタ
-- v2_00_reset.sql → v2_01_schema.sql → このファイル の順に実行する
-- 運用開始: 2026-10-01
-- ============================================================

-- ---------- users ----------
insert into users (name) values ('りほ'), ('ゆうき');

-- ---------- accounts ----------
insert into accounts (id, name, kind, sort_order) values
  (1, '共通りそな', 'resona',  1),
  (2, '貯蓄口座',   'savings', 2),
  (3, '運用資産',   'invest',  3);
select setval('accounts_id_seq', 3);

-- ============================================================
-- 共通りそな
-- 2人が入れた249,000から、家賃と日々の生活費を払う
-- ============================================================

insert into categories (name, account_id, kind, is_variable, sort_order) values
  ('拠出（りほ）',   1, '収入', false, 1),
  ('拠出（ゆうき）', 1, '収入', false, 2),
  ('家賃+火災保険',  1, '支出', false, 10),
  ('食費',           1, '支出', true,  11),
  ('外食',           1, '支出', true,  12),
  ('出前',           1, '支出', true,  13),
  ('日用品',         1, '支出', true,  14),
  ('光熱費',         1, '支出', true,  15),
  ('娯楽・買い物',   1, '支出', true,  16);

insert into category_budgets (category_id, amount, valid_from)
select c.id, v.amount, date '2026-10-01'
from categories c
join (values
  ('拠出（りほ）',   115000),
  ('拠出（ゆうき）', 134000),
  ('家賃+火災保険',  135000),
  ('食費',            30000),
  ('外食',            25000),
  ('出前',            10000),
  ('日用品',          10000),
  ('光熱費',          20000),
  ('娯楽・買い物',    19000)
) as v(name, amount) on v.name = c.name;

-- 自動計上（金額が確定しているもののみ）
insert into fixed_entries (name, kind, category_id, amount, payer, day_of_month, frequency, valid_from)
select v.nm, v.knd::entry_kind, c.id, v.amt, v.payer::owner_type, v.dom, 'monthly', date '2026-10-01'
from (values
  ('拠出（りほ）',   '収入', '拠出（りほ）',   115000, 'りほ',   25),
  ('拠出（ゆうき）', '収入', '拠出（ゆうき）', 134000, 'ゆうき', 25),
  ('家賃+火災保険',  '支出', '家賃+火災保険',  135000, '共通',    1)
) as v(nm, knd, cat, amt, payer, dom)
join categories c on c.name = v.cat;

-- ============================================================
-- 貯蓄口座
-- 毎月10万が自動で入る。ボーナス・還付金は変動するため手入力。
-- 年間支出（旅行・住民税など）もここから出す。
-- ============================================================

insert into categories (name, account_id, kind, is_variable, sort_order) values
  ('積立（りほ）',   2, '収入', false, 20),
  ('積立（ゆうき）', 2, '収入', false, 21),
  ('ボーナス',       2, '収入', false, 22),
  ('還付金',         2, '収入', false, 23),
  ('旅行',           2, '支出', false, 30),
  ('住民税（りほ）', 2, '支出', false, 31),
  ('娯楽（年間）',   2, '支出', false, 32),
  ('医療費',         2, '支出', false, 33),
  ('ふるさと納税',   2, '支出', false, 34),
  ('イベント',       2, '支出', false, 35),
  ('住まいのもの',   2, '支出', false, 36),
  ('税理士',         2, '支出', false, 37);

insert into category_budgets (category_id, amount, valid_from)
select c.id, v.amount, date '2026-10-01'
from categories c
join (values
  ('積立（りほ）',   77000),
  ('積立（ゆうき）', 23000)
) as v(name, amount) on v.name = c.name;

insert into fixed_entries (name, kind, category_id, amount, payer, day_of_month, frequency, valid_from)
select v.nm, '収入', c.id, v.amt, v.payer::owner_type, 25, 'monthly', date '2026-10-01'
from (values
  ('積立（りほ）',   '積立（りほ）',   77000, 'りほ'),
  ('積立（ゆうき）', '積立（ゆうき）', 23000, 'ゆうき')
) as v(nm, cat, amt, payer)
join categories c on c.name = v.cat;

-- 年間支出の目安（予算ではなく参考値）
insert into annual_targets (year, category_id, amount)
select y.year, c.id, v.amt
from (values (2026), (2027)) as y(year)
cross join (values
  ('旅行',           150000),
  ('住民税（りほ）',  79300),
  ('娯楽（年間）',   100000),
  ('医療費',          15000),
  ('ふるさと納税',    30000),
  ('イベント',       132000),
  ('住まいのもの',         0),
  ('税理士',          45000)
) as v(nm, amt)
join categories c on c.name = v.nm;

-- ============================================================
-- 運用資産
-- 各自の給与口座から自動で引かれる。現金ではないので貯蓄残高とは分けて表示する。
-- ============================================================

insert into categories (name, account_id, kind, is_variable, sort_order) values
  ('個人年金',   3, '収入', false, 40),
  ('自社株',     3, '収入', false, 41),
  ('投資信託',   3, '収入', false, 42);

insert into category_budgets (category_id, amount, valid_from)
select c.id, v.amount, date '2026-10-01'
from categories c
join (values
  ('個人年金', 14000),
  ('自社株',   30000),
  ('投資信託', 10000)
) as v(name, amount) on v.name = c.name;

insert into fixed_entries (name, kind, category_id, amount, payer, day_of_month, frequency, valid_from)
select v.nm, '収入', c.id, v.amt, v.payer::owner_type, 1, 'monthly', date '2026-10-01'
from (values
  ('個人年金', '個人年金', 14000, 'ゆうき'),
  ('自社株',   '自社株',   30000, 'りほ'),
  ('投資信託', '投資信託', 10000, 'りほ')
) as v(nm, cat, amt, payer)
join categories c on c.name = v.cat;

-- ============================================================
-- 店名ルール
-- ============================================================
insert into merchant_rules (pattern, category_id, priority)
select v.pat, c.id, 0
from (values
  ('HAMAZUSHI',    '外食'),
  ('SUSHIRO',      '外食'),
  ('MCDONALD',     '外食'),
  ('YAKINIKU',     '外食'),
  ('SEVEN',        '食費'),
  ('LAWSON',       '食費'),
  ('FAMILYMART',   '食費'),
  ('LIFE CORPORA', '食費'),
  ('DAIMARU',      '食費'),
  ('DEMAECAN',     '出前'),
  ('ROCKET NOW',   '出前'),
  ('SUGI PHARMA',  '日用品'),
  ('SUGIDAMA',     '日用品'),
  ('AMAZON',       '娯楽・買い物'),
  ('STEAMGAMES',   '娯楽・買い物'),
  ('Nintendo',     '娯楽・買い物'),
  ('UNIQLO',       '娯楽・買い物')
) as v(pat, cat)
join categories c on c.name = v.cat;

-- ============================================================
-- 設定
-- ============================================================
insert into settings (key, value) values
  ('start_month', '2026-10-01');

-- ---------- 運用開始月の固定収支を計上 ----------
select fn_generate_fixed(date '2026-10-01');
