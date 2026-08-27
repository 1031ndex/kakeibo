'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError('メールアドレスかパスワードが違います');
    setBusy(false);
  }

  return (
    <div className="login-wrap">
      <span className="login-mark">KAKEIBO</span>
      <h1 style={{ margin: '0 0 22px', fontSize: 21 }}>ログイン</h1>

      <div className="field">
        <label htmlFor="email">メールアドレス</label>
        <input id="email" type="email" inputMode="email" autoComplete="username"
          value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="pw">パスワード</label>
        <input id="pw" type="password" autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>

      {error && <p className="error">{error}</p>}

      <div style={{ marginTop: 20 }}>
        <button className="btn" onClick={signIn} disabled={busy}>
          {busy ? '確認中' : 'ログイン'}
        </button>
      </div>
    </div>
  );
}
