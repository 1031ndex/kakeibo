# 家計簿 — 第1段階

りそなデビットのメールを自動で取り込み、iPhoneのホーム画面から開ける家計簿。

## 構成

```
Gmail（りほ宛のりそなメール）
   ↓ Google Apps Script（1時間ごと）
Supabase（PostgreSQL）
   ↓
Next.js アプリ（Vercel）→ iPhoneのホーム画面に追加
```

すべて無料枠で動きます。

---

## セットアップ

所要時間はおよそ1時間です。上から順に進めてください。

### 1. Supabaseプロジェクトを作る

1. https://supabase.com でサインアップし、New project を作成
2. リージョンは Northeast Asia (Tokyo) を選ぶ
3. データベースのパスワードは控えておく

### 2. テーブルを作る

SQL Editor で以下を順に実行します。

1. `sql/01_schema.sql` を貼り付けて Run
2. `sql/02_seed.sql` を貼り付けて Run

エラーが出なければ完了です。Table Editor に categories などが並びます。

### 3. ログインアカウントを2つ作る

Authentication → Users → Add user から2件作成します。

- りほ用のメールアドレスとパスワード
- ゆうき用のメールアドレスとパスワード

作成後、Authentication → Providers → Email を開き、**Enable sign ups をオフ**にします。これで第三者が勝手に登録できなくなります。

次に SQL Editor で、作ったアカウントを users テーブルに紐づけます。

```sql
update users set auth_user_id = (select id from auth.users where email = 'りほのメールアドレス')
where name = 'りほ';

update users set auth_user_id = (select id from auth.users where email = 'ゆうきのメールアドレス')
where name = 'ゆうき';
```

### 4. アプリを動かす

Project Settings → API から2つの値をコピーします。

- Project URL
- anon public キー

`.env.local.example` を `.env.local` にコピーして、この2つを書き込みます。

```bash
npm install
npm run dev
```

http://localhost:3000 を開いてログインできれば成功です。

### 5. Vercelに公開する

1. このフォルダをGitHubリポジトリにpushする
2. https://vercel.com で Import Project
3. Environment Variables に `NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_ANON_KEY` を登録
4. Deploy

### 6. iPhoneのホーム画面に追加する

1. Safariで公開されたURLを開く
2. 共有ボタン → ホーム画面に追加
3. アイコンから全画面で起動します

**Chromeではなく必ずSafariで**追加してください。iOSはSafari以外からのホーム画面追加に対応していません。

### 7. Gmail取込を設定する

1. https://script.google.com で新しいプロジェクトを作る
2. `gas/resona_to_supabase.gs` の中身を貼り付ける
3. 「プロジェクトの設定」→「スクリプト プロパティ」に3つ登録する

| キー | 値 |
|---|---|
| SUPABASE_URL | Project URL |
| SUPABASE_KEY | **service_role** キー（anonではない） |
| ERROR_MAIL_TO | エラー通知を受け取るメールアドレス |

4. `dryRun` を実行して、ログに日時・金額・店名が正しく出るか確認する
5. 問題なければ `setup` を実行する（ラベルと1時間ごとのトリガーが作られる）

service_role キーはGASのプロパティにだけ置いてください。アプリ側には絶対に入れません。

---

## 使い方

### ホーム

3つの数字が出ます。

- **今月の残予算** — 変動費（食費・外食・出前・日用品・娯楽）の予算に対する残り
- **貯蓄の進捗** — 今年の貯蓄実績と年間目標
- **今月の支出合計** — 貯蓄は含みません

月を切り替えると、その月の固定収支（家賃・光熱費・給与など）が自動で計上されます。二重には入りません。

### 未分類

デビットで払うと、店名は分かってもカテゴリは分かりません。ここで振り分けます。

カテゴリを1回タップすれば終わりです。「今後この店は自動で同じカテゴリにする」にチェックが入っていれば、次から自動で分類されます。使うほど未分類が減ります。

誤って覚えさせた場合は、Supabaseの merchant_rules テーブルから該当行を削除してください（ルール編集画面は第2段階で作ります）。

### 明細

月ごとの記帳一覧です。デビットが使えなかった店での立替は「手入力で追加」から登録し、支払者を選びます。

---

## マスタの変更方法

Supabaseの Table Editor から編集します。

### 引越し・昇給・育休で金額が変わったら

**行を書き換えないでください。**過去の集計が変わってしまいます。

`category_budgets` の該当行の `valid_to` に「最後に適用する月の末日」を入れて閉じ、新しい行を追加します。

```sql
-- 例: 家賃が2027年4月から150,000になる場合
update category_budgets set valid_to = '2027-03-31'
where category_id = (select id from categories where name = '家賃+火災保険')
  and valid_to is null;

insert into category_budgets (category_id, amount, valid_from)
select id, 150000, '2027-04-01' from categories where name = '家賃+火災保険';
```

給与も同じです。`fixed_entries` の `valid_to` を閉じて、新しい行を足します。

**valid_from には未来の日付を入れられます。**育休の開始月が決まったら、その月の1日を指定して登録しておけば、その月から自動で切り替わります。事前の作業は不要です。

### NISAを始めたら

```sql
insert into categories (name, owner, kind, pocket_id, is_variable, sort_order)
values ('NISA', '共通', '貯蓄', 3, false, 34);

insert into category_budgets (category_id, amount, valid_from)
select id, 40000, '2027-01-01' from categories where name = 'NISA';

insert into savings_goals (year, category_id, target_amount)
select 2027, id, 480000 from categories where name = 'NISA';
```

### 拠出額を変えたい

`contributions` の該当行を閉じて、新しい行を足します。やり方は予算と同じです。

---

## 設計上の判断

作る過程で決めたことのうち、後で疑問に思いそうな点を残しておきます。

**貯蓄を支出から分離した**
個人年金・自社株・投資信託は `kind = 貯蓄` で、支出集計に入りません。旧「家計簿2026」ではこれらが支出予算と貯蓄目標の両方に計上され、過不足チェックが -1,248,000 とずれていました。

**重複排除キーをGmailメッセージ IDにした**
りそなの承認番号は6桁しかありません。これをキーにすると、いずれ別の取引と番号が衝突し、正常な明細が「登録済み」と誤判定されて静かに欠落します。メッセージ IDなら1メール＝1取引で確実に一意です。

**返金メールをマイナス金額で登録する**
りそなは返品・取消があると「入金取引のご連絡」という別形式のメールを送ります。件名も金額の項目名（ご入金金額）も違うため、旧GASはこれを読めずに捨てていました。同じカテゴリにマイナスで入れることで、集計上で自然に相殺されます。

**カテゴリ自動判定にAIを使っていない**
店名の部分一致ルールを `merchant_rules` に貯める方式です。従量課金が発生せず、誤りは1行消せば直せます。

**年間支出は積み立てない**
旅行・住民税などは各自の個人口座から都度支払い、精算対象外としています。`fn_contributions` の拠出額計算からも除外されます。

**光熱費を変動費にしていない**
口座引落なのでデビットのメールが来ず、実績が自動で入りません。変動費にすると毎月手入力が必要になる割に、日々の判断材料にはなりません。20,000で固定計上しています。

---

## 第2段階以降の予定

- 予算vs実績の画面
- カレンダー（1日始まり）
- グラフ（カテゴリ別・月次推移）
- 精算と拠出額の自動計算（`fn_contributions` はSQL側に実装済み）
- 貯蓄・投資の進捗、複利シミュレーション、目標逆算
- 年間支出の管理
- LINE通知
