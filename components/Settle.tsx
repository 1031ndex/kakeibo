'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  ACCOUNT, fetchSettlement, fetchRangeTx, yen, iso,
  type Settlement, type Tx,
} from '@/lib/db';

/**
 * その月の25日に2人が共通りそなへ入れる額。
 * 前の期間（前月25日〜当月24日）に本人が立て替えた分と、
 * その月の誕生日プレゼントは、拠出から差し引く。
 */
export default function Settle({ month, version }: { month: Date; version: number }) {
  const [rows, setRows] = useState<Settlement[]>([]);
  const [minus, setMinus] = useState<Tx[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const from = new Date(month.getFullYear(), month.getMonth() - 1, 25);
      const to = new Date(month.getFullYear(), month.getMonth() + 1, 0);
      const [s, t] = await Promise.all([
        fetchSettlement(month),
        fetchRangeTx(ACCOUNT.RESONA, from, to),
      ]);
      const ms = iso(new Date(month.getFullYear(), month.getMonth(), 1));
      const end24 = iso(new Date(month.getFullYear(), month.getMonth(), 24));
      setRows(s);
      setMinus(t.filter((x) => x.payer !== '共通' && x.type === '支出' && (
        x.source === 'fixed' ? x.period_month === ms : x.occurred_on <= end24
      )));
      setError('');
    } catch (e: any) {
      setError(e.message ?? '読み込めませんでした');
    }
  }, [month]);

  // version は親が再読み込みしたときに増える。手入力のあとも取り直すため
  useEffect(() => { load(); }, [load, version]);

  return (
    <>
      {error && <p className="error">{error}</p>}

      <p className="eyebrow">{month.getMonth() + 1}/25に共通りそなへ入れる額</p>

      {rows.map((r) => (
        <div className="settle" key={r.user_name}>
          <div className="settle-name">{r.user_name}</div>
          <div className="settle-pay">{yen(r.to_pay)} 円</div>
          {r.advanced !== 0 && (
            <div className="settle-calc">
              いつもの {yen(r.base_amount)} − 差し引き {yen(r.advanced)}
            </div>
          )}
        </div>
      ))}

      {minus.length > 0 ? (
        <>
          <p className="eyebrow">差し引く分</p>
          <div className="ledger">
            {minus.map((t) => (
              <div className="list-row" key={t.id}>
                <span>
                  <span className="name">{t.merchant || t.categories?.name}</span><br />
                  <span className="sub">
                    {t.occurred_on.replace(/-/g, '/')}　{t.payer}
                    {t.source === 'fixed' ? '　手元に残して使う分' : '　立替'}
                  </span>
                </span>
                <span className="row-amount num">{yen(t.amount)}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="figure-sub" style={{ marginTop: 10 }}>
          この月に差し引く分はありません。いつもの額を入れてください。
        </p>
      )}
    </>
  );
}
