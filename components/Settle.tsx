'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  ACCOUNT, fetchSettlement, fetchMonthTx, yen, monthLabel,
  type Settlement, type Tx,
} from '@/lib/db';

/**
 * その月に2人が共通りそなへ入れる額。
 * 本人が払った共通の支出（デビットが使えなかった店の立替・誕生日プレゼント）は
 * その月の拠出から差し引く。
 */
export default function Settle({ month, version }: { month: Date; version: number }) {
  const [rows, setRows] = useState<Settlement[]>([]);
  const [minus, setMinus] = useState<Tx[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([
        fetchSettlement(month),
        fetchMonthTx(ACCOUNT.RESONA, month),
      ]);
      setRows(s);
      setMinus(t.filter((x) => x.payer !== '共通' && x.type === '支出'));
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

      <p className="eyebrow">{monthLabel(month)}に共通りそなへ入れる額</p>

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
