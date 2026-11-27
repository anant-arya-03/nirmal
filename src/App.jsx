import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutDashboard, ShoppingBag, MapPin, MessageSquare, Bell, Settings, Users, UserRound, ChartNoAxesCombined, Plus, Search, Sun, Moon, PanelLeftClose, PanelLeftOpen, LogOut, RefreshCw, Command, X, Menu } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Auth from './Auth.jsx';
import { api, go, Modal } from './shared.jsx';
import { Overview, Laundry, Complaints, ComplaintDetail, NewComplaint, People, Analytics, Notifications, SettingsPage } from './pages.jsx';

const studentNav = [['overview','Overview',LayoutDashboard],['laundry','My laundry',ShoppingBag],['tracking','Track bag',MapPin],['new','Raise complaint',Plus],['complaints','My complaints',MessageSquare],['notifications','Notifications',Bell],['settings','Profile & settings',Settings]];
const adminNav = [['overview','Operations overview',LayoutDashboard],['complaints','Complaints',MessageSquare],['laundry','Laundry operations',ShoppingBag],['tracking','Live bag tracking',MapPin],['students','Students',Users],['workers','Workers',UserRound],['analytics','Analytics & reports',ChartNoAxesCombined],['notifications','Notifications',Bell],['settings','System settings',Settings]];
function themeInitial() { try { return localStorage.getItem('nirmal-theme') || 'light'; } catch { return 'light'; } }
export default function App() {
  const [user, setUser] = useState(null), [boot, setBoot] = useState(true), [route, setRoute] = useState(location.hash.slice(1) || 'overview');
  const [data, setData] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(false), [toast, setToast] = useState('');
  const [theme, setTheme] = useState(themeInitial), [collapsed, setCollapsed] = useState(false), [mobile, setMobile] = useState(false), [command, setCommand] = useState(false), [search, setSearch] = useState('');
  const currentUser=useRef(null), refreshSequence=useRef(0);
  currentUser.current=user?.id;
  const admin = user?.role === 'admin', nav = admin ? adminNav : studentNav, page = route.split('/')[0];
  const refresh = useCallback(async () => {
    if (!user) return;
    const sequence=++refreshSequence.current;
    setLoading(true); setError('');
    try {
      const [bags, complaints, notifications, settings, students, workers, analytics] = await Promise.all([api('/bags'), api('/complaints'), api('/notifications'), api('/settings'), admin ? api('/students') : [], admin ? api('/workers') : [], admin ? api('/analytics') : null]);
      if(currentUser.current===user.id && sequence===refreshSequence.current) setData({ bags, complaints, notifications, settings, students, workers, analytics });
    } catch (e) { if(currentUser.current!==user.id || sequence!==refreshSequence.current)return; if (e.status === 401) { setUser(null); setData(null); } else setError(e.message); }
    finally { if(sequence===refreshSequence.current)setLoading(false); }
  }, [user, admin]);
  useEffect(() => { api('/me').then(setUser).catch(e => { if (e.status !== 401) setError(e.message); }).finally(() => setBoot(false)); const hash = () => { setRoute(location.hash.slice(1) || 'overview'); setMobile(false); }; addEventListener('hashchange', hash); return () => removeEventListener('hashchange', hash); }, []);
  useEffect(() => { refresh(); if (!user) return; const timer = setInterval(refresh, 30000); return () => clearInterval(timer); }, [refresh, user]);
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('nirmal-theme', theme); } catch {} }, [theme]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 5000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { const key = e => { if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); setCommand(v => !v); } }; addEventListener('keydown', key); return () => removeEventListener('keydown', key); }, []);
  const saved = async (message = 'Changes saved.') => { setToast(message); await refresh(); };
  if (boot) return <div className="boot"><img src="/mark.svg" alt="Nirmal"/><p>Opening your workspace…</p></div>;
  if (!user) return <><Auth route={route} onLogin={u => { setUser(u); go('overview'); }}/>{error && <div className="toast error" role="alert">{error}</div>}</>;
  const ctx = { user, admin, data, saved, setUser, loading };
  const titles = Object.fromEntries(nav.map(n => [n[0], n[1]]));
  let view;
  if (!data) view = <div className="skeleton-grid" aria-label="Loading workspace">{[1,2,3,4,5,6].map(n => <div className="skeleton" key={n}/>)}</div>;
  else if (page === 'overview') view = <Overview {...ctx}/>;
  else if (page === 'laundry' || page === 'tracking') view = <Laundry {...ctx} tracking={page === 'tracking'}/>;
  else if (page === 'complaints') view = route.includes('/') ? <ComplaintDetail {...ctx} id={route.split('/')[1]}/> : <Complaints {...ctx}/>;
  else if (page === 'new' && !admin) view = <NewComplaint {...ctx}/>;
  else if (['students','workers'].includes(page) && admin) view = <People {...ctx} kind={page} key={page}/>;
  else if (page === 'analytics' && admin) view = <Analytics {...ctx}/>;
  else if (page === 'notifications') view = <Notifications {...ctx}/>;
  else if (page === 'settings') view = <SettingsPage {...ctx}/>;
  else view = <div className="panel"><h1>Page not found</h1><button className="button" onClick={() => go('overview')}>Go to overview</button></div>;
  return <div className={`app-shell ${collapsed ? 'collapsed' : ''}`}><a className="skip-link" href="#main-content" onClick={e => { e.preventDefault(); document.getElementById('main-content').focus(); }}>Skip to content</a>
    {mobile && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobile(false)}/>}
    <aside className={`sidebar ${mobile ? 'open' : ''}`}><a className="brand" href="#overview"><img src="/mark.svg" alt=""/><span>Nirmal <small>निर्मल</small></span></a><div className="workspace-label"><span className="workspace-icon">{admin ? 'O' : 'S'}</span><span><strong>{admin ? 'Operations workspace' : 'Student workspace'}</strong><small>{data?.settings.campus_name || 'Campus laundry'}</small></span></div><div className="nav-label">WORKSPACE</div><nav>{nav.map(([path, label, Icon]) => <a title={collapsed ? label : undefined} href={`#${path}`} key={path} className={page === path ? 'active' : ''} aria-current={page === path ? 'page' : undefined}><Icon size={19}/><span>{label}</span>{path === 'complaints' && !!data?.complaints.filter(c => !['Resolved','Closed'].includes(c.status)).length && <small className="nav-count">{data.complaints.filter(c => !['Resolved','Closed'].includes(c.status)).length}</small>}</a>)}</nav><div className="sidebar-bottom"><div className="process-note"><span className="tiny-logo">n.</span><p>A little care.<br/>A cleaner campus.</p></div><button className="profile-button" onClick={() => go('settings')}><span className="avatar">{user.name.slice(0,1)}</span><span><strong>{user.name}</strong><small>{admin ? 'Administrator' : user.enrollment}</small></span><Settings size={17}/></button><button className="signout" onClick={async () => { try { await api('/logout', 'POST', {}); setUser(null); setData(null); } catch (e) { setToast(e.message); } }}><LogOut size={16}/><span>Sign out</span></button></div></aside>
    <div className="workspace"><header className="topbar"><div className="breadcrumb"><button className="icon-button desktop-only" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed(v => !v)}>{collapsed ? <PanelLeftOpen size={19}/> : <PanelLeftClose size={19}/>}</button><button className="icon-button mobile-only" aria-label="Open navigation" onClick={() => setMobile(true)}><Menu size={20}/></button><span>Workspace</span><span className="slash">/</span><strong>{titles[page] || 'Details'}</strong></div><div className="topbar-actions"><button className="search-command" onClick={() => { setSearch(''); setCommand(true); }}><Search size={17}/><span>Jump to…</span><kbd>Ctrl K</kbd></button><button className="icon-button" aria-label="Refresh records" onClick={refresh}><RefreshCw size={18} className={loading ? 'spin' : ''}/></button><button className="icon-button" aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'} onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Moon size={18}/> : <Sun size={18}/>}</button><button className="icon-button notification-button" aria-label="Open notifications" onClick={() => go('notifications')}><Bell size={19}/>{data?.notifications.some(n => !n.seen) && <i/>}</button></div></header>
    <main id="main-content" tabIndex={-1}>{error && <div className="error" role="alert">{error}<button className="text-button" onClick={refresh}>Retry</button></div>}<AnimatePresence mode="wait"><motion.div key={route} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : .15 }}>{view}</motion.div></AnimatePresence><footer className="workspace-footer"><span>Nirmal · Clean clothes. Clear process.</span><span>Updates every 30 seconds</span></footer></main></div>
    {toast && <div role="status" className="toast">{toast}<button aria-label="Dismiss notification" onClick={() => setToast('')}><X size={16}/></button></div>}
    {command && <Modal title="Jump to your next task" close={() => setCommand(false)}><div className="command-search"><Search size={20}/><input autoFocus aria-label="Search pages" placeholder="Search pages…" value={search} onChange={e => setSearch(e.target.value)}/><Command size={18}/></div><div className="command-results">{nav.filter(n => n[1].toLowerCase().includes(search.toLowerCase())).map(([path,label,Icon]) => <button key={path} onClick={() => { go(path); setCommand(false); }}><Icon size={18}/>{label}</button>)}</div></Modal>}
  </div>;
}
