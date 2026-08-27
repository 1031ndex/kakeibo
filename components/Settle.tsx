'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  ACCOUNT, fetchSettlement, fetchMonthTx, yen, monthLabel,
  type Settlement, type Tx,
} from '@/lib/db';

export default function Settle({ month }: { month: Date }) {
  const [rows, setRows] = useState<Settlement[]>([]);
  const [advanced, setAdvanced] = useState<Tx[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([
        fetchSettlement(month),
        fetchMonthTx(ACCOUNT.RESONA, month),
      ]);
      setRows(s);
      setAdvanced(t.filter((x) => x.payer !== '共通' && x.type === '支出'));
      setError('');
    } catch (e: any) {
      setError(e.message ?? '読み込めませんでした');
    }
  }, [month]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      {error && <p className="error">{error}</p>}

      <p className="eyebrow">{monthLabel(month)}に共通りそなへ入れる額</p>

      {rows.map((r) => (
        <div className="settle" key={r.user_name}>
          <div className="settle-name">{r.user_name}</div>
          <div className="settle-pay">{yen(r.to_pay)} 円</div>
          {r.advanced > 0 && (
            <div className="settle-calc">
              基準 {yen(r.base_amount)} − 立替 {yen(r.advanced)}
            </div>
          )}
        </div>
      ))}

      {advanced.length > 0 && (
        <>
          <p className="eyebrow">立替の明細</p>
          <div className="ledger">
            {advanced.map((t) => (
              <div className="list-row" key={t.id}>
                <span>
                  <span className="name">{t.merchant || t.categories?.name}</span><br />
                  <span className="sub">
                    {t.occurred_on.replace(/-/g, '/')}　{t.categories?.name}　{t.payer}
                  </span>
                </span>
                <span className="row-amount num">{yen(t.amount)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {advanced.length === 0 && (
        <p className="figure-sub" style={{ marginTop: 10 }}>
          この月の立替はありません。基準額をそのまま入れてください。
        </p>
      )}
    </>
  );
}
