import React, { useState } from 'react';
import { Leaf, ShieldCheck, Shirt } from 'lucide-react';
import { api, Field, Form, go } from './shared.jsx';
export default function Auth({ onLogin, route }) {
  const [mode, setMode] = useState(route.startsWith('reset/') ? 'reset' : 'login');
  const [message, setMessage] = useState('');
  const change = mode => { setMode(mode); setMessage(''); };
  return <div className="auth"><aside className="auth-story"><a href="#" className="brand"><img src="/mark.svg" alt=""/><span>Nirmal <small>निर्मल</small></span></a><div><span className="eyebrow">A LITTLE LESS TO WORRY ABOUT</span><h1>Campus life is busy.<br/>Laundry can be simple.</h1><p>From your first collection to the last folded shirt. Know where things stand, every step of the way.</p><div className="laundry-illustration" aria-hidden="true"><div className="machine"><div className="machine-controls"><i/><i/><span/></div><div className="machine-door"><Shirt size={70} strokeWidth={1}/></div></div><div className="folded f1"/><div className="folded f2"/><div className="folded f3"/><Leaf className="plant" size={100} strokeWidth={1}/></div></div><p className="auth-footer">Clean clothes. Clear process.</p></aside><main className="auth-form"><div className="auth-card"><span className="eyebrow">YOUR CAMPUS, CONNECTED</span><h1>{({ login: 'Welcome back.', register: 'Make yourself at home.', forgot: 'Let’s get you back in.', reset: 'A fresh start.' })[mode]}</h1><p className="muted">{mode === 'login' ? 'Sign in to your student or administrator workspace.' : mode === 'register' ? 'Register with your university details.' : 'Reset your password securely.'}</p>{message && <p className="success" role="status">{message}</p>}
    <Form key={mode} label={{ login: 'Sign in', register: 'Create student account', forgot: 'Send reset link', reset: 'Set new password' }[mode]} onSave={async data => {
      if (mode === 'login' || mode === 'register') onLogin(await api(`/auth/${mode}`, 'POST', data));
      if (mode === 'forgot') { const result = await api('/auth/forgot', 'POST', data); setMessage(result.message); }
      if (mode === 'reset') { await api('/auth/reset', 'POST', { ...data, token: route.split('/')[1] }); change('login'); go(''); setMessage('Password updated. Sign in with your new password.'); }
    }}>
      {mode === 'register' && <><Field label="Full name" name="name" autoComplete="name" required minLength={2} maxLength={100}/><div className="form-grid"><Field label="Enrollment number" name="enrollment" required maxLength={40}/><Field label="Contact number" name="phone" type="tel" autoComplete="tel" required minLength={7} maxLength={20}/><Field label="Hostel block" name="hostel" required maxLength={60}/><Field label="Room number" name="room" required maxLength={20}/></div></>}
      {mode !== 'reset' && <Field label="University email" name="email" type="email" autoComplete="email" placeholder="you@university.edu" required maxLength={254}/>}
      {mode !== 'forgot' && <Field label={mode === 'reset' ? 'New password' : 'Password'} name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'login' ? 1 : 12} maxLength={128}/>}
      {['register', 'reset'].includes(mode) && <small className="muted">Use at least 12 characters.</small>}
    </Form>
    <div className="auth-links">{mode === 'login' ? <><button className="text-button" onClick={() => change('forgot')}>Forgot password?</button><p>New here? <button className="text-button" onClick={() => change('register')}>Create an account</button></p></> : <button className="text-button" onClick={() => change('login')}>Back to sign in</button>}</div><div className="secure-note"><ShieldCheck size={17}/> Your records stay in your workspace.</div></div></main></div>;
}
