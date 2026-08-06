import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { MeResponse, UserPublic } from '@fold/shared'
import { BarChart3, CalendarRange, LayoutDashboard, ListChecks, LogOut, MoreHorizontal, PiggyBank, ReceiptText, Settings as SettingsIcon, TrendingUp } from 'lucide-react'
import { api } from './api'
import { Avatar, cls } from './ui'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Budget from './pages/Budget'
import Transactions from './pages/Transactions'
import Trips from './pages/Trips'
import TripDetail from './pages/TripDetail'
import Lists from './pages/Lists'
import NetWorth from './pages/NetWorth'
import Reports from './pages/Reports'
import Review from './pages/Review'
import Settings from './pages/Settings'

interface MeContextValue {
  me: MeResponse
  reloadMe: () => Promise<void>
  signOut: () => Promise<void>
}

const MeContext = createContext<MeContextValue | null>(null)

export function useMe(): MeContextValue {
  const value = useContext(MeContext)
  if (!value) throw new Error('useMe outside provider')
  return value
}

const NAV = [
  { to: '/', label: 'Home', icon: LayoutDashboard },
  { to: '/budget', label: 'Budget', icon: PiggyBank },
  { to: '/transactions', label: 'Spending', icon: ReceiptText },
  { to: '/networth', label: 'Net worth', icon: TrendingUp },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/trips', label: 'Trips', icon: CalendarRange },
  { to: '/lists', label: 'Lists', icon: ListChecks },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
]

// Phones get four real tabs (the daily set) + a More sheet — eight cramped tabs helps nobody.
const MOBILE_MAIN = ['/', '/budget', '/transactions', '/lists']
const MAIN_TABS = NAV.filter((n) => MOBILE_MAIN.includes(n.to))
const MORE_TABS = NAV.filter((n) => !MOBILE_MAIN.includes(n.to))

function Shell({ children }: { children: ReactNode }) {
  const { me, signOut } = useMe()
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  useEffect(() => setMoreOpen(false), [location.pathname])
  const onMorePage = MORE_TABS.some((n) => location.pathname.startsWith(n.to))
  return (
    <div className="min-h-screen md:flex">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-slate-200 bg-white px-3 py-5 md:flex md:sticky md:top-0 md:h-screen">
        <div className="mb-6 flex items-center gap-2 px-2">
          <span className="text-2xl">🪺</span>
          <div>
            <p className="text-base font-bold leading-tight">The Fold</p>
            <p className="text-xs text-slate-500">{me.household.name}</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cls(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium',
                  isActive ? 'bg-violet-50 text-violet-700' : 'text-slate-600 hover:bg-slate-100',
                )
              }
            >
              <Icon size={17} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-4 flex items-center gap-2 border-t border-slate-200 px-2 pt-4">
          <Avatar name={me.user.name} color={me.user.color} />
          <span className="flex-1 truncate text-sm font-medium">{me.user.name}</span>
          <button
            onClick={() => void signOut()}
            title="Sign out"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
          <div className="flex items-center gap-2">
            <span className="text-xl">🪺</span>
            <span className="font-bold">The Fold</span>
          </div>
          <button onClick={() => void signOut()} className="p-1.5 text-slate-400">
            <LogOut size={17} />
          </button>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 pb-24 md:px-8 md:pb-8">{children}</main>
        {moreOpen && (
          <div className="fixed inset-0 z-40 bg-slate-900/30 md:hidden" onClick={() => setMoreOpen(false)}>
            <div
              className="absolute inset-x-0 bottom-[3.5rem] rounded-t-2xl border-t border-slate-200 bg-white p-4 pb-3 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="grid grid-cols-2 gap-2">
                {MORE_TABS.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) =>
                      cls(
                        'flex items-center gap-2.5 rounded-xl px-3.5 py-3 text-sm font-medium',
                        isActive ? 'bg-violet-50 text-violet-700' : 'bg-slate-50 text-slate-700',
                      )
                    }
                  >
                    <Icon size={18} />
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>
          </div>
        )}
        <nav className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-slate-200 bg-white pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] md:hidden">
          {MAIN_TABS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setMoreOpen(false)}
              className={({ isActive }) =>
                cls(
                  'flex flex-col items-center gap-0.5 rounded-lg px-3 py-1 text-[10px] font-medium',
                  isActive && !moreOpen ? 'text-violet-700' : 'text-slate-500',
                )
              }
            >
              <Icon size={19} />
              {label}
            </NavLink>
          ))}
          <button
            onClick={() => setMoreOpen((v) => !v)}
            className={cls(
              'flex flex-col items-center gap-0.5 rounded-lg px-3 py-1 text-[10px] font-medium',
              moreOpen || onMorePage ? 'text-violet-700' : 'text-slate-500',
            )}
          >
            <MoreHorizontal size={19} />
            More
          </button>
        </nav>
      </div>
    </div>
  )
}

export default function App() {
  const [phase, setPhase] = useState<'loading' | 'login' | 'app'>('loading')
  const [me, setMe] = useState<MeResponse | null>(null)
  const [boot, setBoot] = useState<{ has_users: boolean; signup_open: boolean }>({ has_users: true, signup_open: false })
  const location = useLocation()

  async function loadMe(): Promise<void> {
    const result = await api.get<MeResponse>('/me')
    setMe(result)
    setPhase('app')
  }

  useEffect(() => {
    api
      .get<{ user: UserPublic | null; has_users: boolean; signup_open: boolean }>('/bootstrap')
      .then((result) => {
        setBoot({ has_users: result.has_users, signup_open: result.signup_open })
        if (!result.user) setPhase('login')
        else return loadMe()
      })
      .catch(() => setPhase('login'))
  }, [])

  if (phase === 'loading') {
    return <div className="flex min-h-screen items-center justify-center text-3xl">🪺</div>
  }
  if (phase === 'login' || !me) return <Login onDone={() => void loadMe()} hasUsers={boot.has_users} signupOpen={boot.signup_open} />

  const context: MeContextValue = {
    me,
    reloadMe: loadMe,
    signOut: async () => {
      await api.post('/auth/logout')
      setMe(null)
      setPhase('login')
    },
  }

  return (
    <MeContext.Provider value={context}>
      <Shell>
        <Routes location={location}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/budget" element={<Budget />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/networth" element={<NetWorth />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/review" element={<Review />} />
          <Route path="/trips" element={<Trips />} />
          <Route path="/trips/:id" element={<TripDetail />} />
          <Route path="/lists" element={<Lists />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </MeContext.Provider>
  )
}
