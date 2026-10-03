import { NavLink, useLocation } from 'react-router-dom'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import {
  Cpu,
  Play,
  KeyRound,
  Bot,
  BarChart2,
  Sparkles,
} from 'lucide-react'

const navItems = [
  { to: '/models', labelKey: 'nav.models', icon: Cpu },
  { to: '/playground', labelKey: 'nav.playground', icon: Play },
  { to: '/keys', labelKey: 'nav.keys', icon: KeyRound },
  { to: '/agents', labelKey: 'nav.agents', icon: Bot },
  { to: '/analytics', labelKey: 'nav.analytics', icon: BarChart2 },
  { to: '/premium', labelKey: 'nav.premium', icon: Sparkles },
] as const

export function Sidebar({ inline = true }: { inline?: boolean } = {}) {
  const { t } = useI18n()
  const location = useLocation()

  // Base classes for the aside element
  const baseClasses = cn(
    'flex-col border-r bg-sidebar',
    'transition-all duration-200 ease-out'
  )

  // Layout classes depending on inline vs drawer
  const layoutClasses = inline
    ? cn('hidden md:flex md:w-64') // original sidebar behavior
    : cn('fixed inset-y-0 left-0 z-50 flex w-64') // drawer overlay

  return (
    <aside
      className={cn(baseClasses, layoutClasses)}
      aria-label="Main navigation"
    >
      <div className="flex h-16 items-center px-6 border-b">
        <NavLink to="/" className="flex items-center gap-2 font-semibold text-lg text-sidebar-foreground">
          <span className="size-2 rounded-full bg-primary" />
          <span>LLM Gateway</span>
        </NavLink>
      </div>
      <nav className="flex-1 space-y-1 p-4" aria-label="Navigation">
        {navItems.map(({ to, labelKey, icon: Icon }) => {
          const isActive = location.pathname === to || location.pathname.startsWith(to + '/')
          return (
            <NavLink
              key={to}
              to={to}
              className={cn(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              )}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon className="size-5 shrink-0" aria-hidden="true" />
              {t(labelKey)}
            </NavLink>
          )
        })}
      </nav>
      <div className="border-t p-4">
        <p className="text-xs text-sidebar-foreground/50">v0.0.0</p>
      </div>
    </aside>
  )
}