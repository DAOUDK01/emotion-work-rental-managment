import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  BadgeEuro,
  Bike,
  ChartColumnBig,
  ChevronRight,
  FileText,
  Handshake,
  KeyRound,
  Languages,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareText,
  Moon,
  Package,
  PlusCircle,
  Receipt,
  Settings,
  ShoppingCart,
  Sun,
  Users,
  Wallet,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import { api } from '@/lib/api';
import { type Role, useAuth } from '@/lib/auth';
import { cn } from '@/components/ui/utils';
import { Button } from '@/components/ui/button';

interface NavItem {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  key: string;
  roles?: Role[];
}

interface NavGroup {
  key: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    key: 'shell.groups.overview',
    items: [
      { to: '/', icon: LayoutDashboard, key: 'nav.dashboard' },
      { to: '/entry', icon: PlusCircle, key: 'nav.addEntry', roles: ['ADMIN', 'STAFF'] },
      { to: '/pos', icon: ShoppingCart, key: 'nav.pos', roles: ['ADMIN', 'STAFF'] },
    ],
  },
  {
    key: 'shell.groups.sales',
    items: [
      { to: '/invoices', icon: FileText, key: 'nav.invoices' },
      { to: '/rentals', icon: KeyRound, key: 'nav.rentals' },
      { to: '/customers', icon: Users, key: 'nav.customers' },
    ],
  },
  {
    key: 'shell.groups.operations',
    items: [
      { to: '/units', icon: Bike, key: 'nav.units' },
      { to: '/inventory', icon: Package, key: 'nav.inventory' },
      // Warranty claims (spec "phase 2") is left out of the menu on purpose to keep it simple;
      // the /claims page still works if opened directly.
      { to: '/contracts', icon: Wrench, key: 'nav.contracts', roles: ['ADMIN', 'ACCOUNTANT'] },
      { to: '/whatsapp', icon: MessageSquareText, key: 'nav.whatsapp', roles: ['ADMIN'] },
    ],
  },
  {
    key: 'shell.groups.finance',
    items: [
      { to: '/expenses', icon: Receipt, key: 'nav.expenses' },
      { to: '/vat', icon: BadgeEuro, key: 'nav.vat' },
      { to: '/cash', icon: Wallet, key: 'nav.cash', roles: ['ADMIN', 'ACCOUNTANT'] },
      { to: '/partners', icon: Handshake, key: 'nav.partners', roles: ['ADMIN', 'ACCOUNTANT'] },
      { to: '/reports', icon: ChartColumnBig, key: 'nav.reports' },
    ],
  },
  {
    key: 'shell.groups.admin',
    items: [{ to: '/settings', icon: Settings, key: 'nav.settings', roles: ['ADMIN'] }],
  },
];

function useDarkMode() {
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem('emf.theme') === 'dark';
    } catch {
      return false;
    }
  });
  const toggle = () => {
    setDark((d) => {
      const next = !d;
      document.documentElement.classList.toggle('dark', next);
      try {
        localStorage.setItem('emf.theme', next ? 'dark' : 'light');
      } catch {
        /* ignore */
      }
      return next;
    });
  };
  return { dark, toggle };
}

function initials(name: string | undefined): string {
  if (!name) return '·';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase();
}

function BrandMark({ companyName, subtitle }: { companyName: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[hsl(var(--sidebar-active))] to-[hsl(199_89%_48%)] text-white shadow-[0_6px_16px_-6px_hsl(var(--sidebar-active)/0.7)]">
        <Zap className="h-[1.1rem] w-[1.1rem]" strokeWidth={2.5} />
      </span>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold leading-tight text-sidebar-foreground">
          {companyName}
        </div>
        <div className="truncate text-2xs text-sidebar-muted">{subtitle}</div>
      </div>
    </div>
  );
}

export function AppShell() {
  const { t, i18n } = useTranslation('common');
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { dark, toggle } = useDarkMode();

  const { data: settings } = useQuery({
    queryKey: ['settings', 'app'],
    queryFn: () => api.get<{ settings: { company?: { name?: string } } }>('/settings/app'),
    staleTime: 5 * 60 * 1000,
  });
  const companyName = settings?.settings.company?.name ?? 'E Motion Works Oy';

  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((n) => !n.roles || (user && n.roles.includes(user.role))),
  })).filter((g) => g.items.length > 0);

  const current = NAV_GROUPS.flatMap((g) => g.items).find((n) =>
    n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to),
  );

  // close the drawer on navigation / Escape
  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMobileOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  const today = new Intl.DateTimeFormat(i18n.language === 'fi' ? 'fi-FI' : 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Helsinki',
  }).format(new Date());

  const nav = (
    <nav
      className="flex-1 space-y-4 overflow-y-auto px-3 pb-4 pt-1 scrollbar-none"
      aria-label="Main"
    >
      {groups.map((g) => (
        <div key={g.key}>
          <div className="mb-1 px-2.5 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-sidebar-muted/70">
            {t(g.key)}
          </div>
          <div className="space-y-0.5">
            {g.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'group relative flex items-center gap-3 rounded-lg px-2.5 py-[0.4rem] text-[0.84rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--sidebar-active))]',
                    isActive
                      ? 'bg-white/[0.08] text-sidebar-foreground shadow-[inset_0_1px_0_0_hsl(0_0%_100%/0.05)]'
                      : 'text-sidebar-muted hover:bg-white/[0.04] hover:text-sidebar-foreground',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      aria-hidden
                      className={cn(
                        'absolute -left-3 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[hsl(var(--sidebar-active))] transition-opacity',
                        isActive ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <item.icon
                      className={cn(
                        'h-[1.05rem] w-[1.05rem] shrink-0 transition-colors',
                        isActive
                          ? 'text-[hsl(var(--sidebar-active))]'
                          : 'text-sidebar-muted/80 group-hover:text-sidebar-foreground',
                      )}
                    />
                    <span className="truncate">{t(item.key)}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );

  const sidebarFooter = (
    <div className="hidden border-t border-sidebar-border px-5 py-3 text-2xs leading-relaxed text-sidebar-muted/70 [@media(min-height:880px)]:block">
      {t('footer.tagline')}
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden" data-app-shell>
      {/* desktop sidebar */}
      <aside className="sidebar-glow hidden w-56 shrink-0 flex-col border-r border-sidebar-border text-sidebar-foreground md:flex lg:w-60">
        <div className="px-5 pb-3 pt-4">
          <BrandMark companyName={companyName} subtitle={t('shell.brandSub')} />
        </div>
        {nav}
        {sidebarFooter}
      </aside>

      {/* mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-[hsl(var(--shadow)/0.5)] backdrop-blur-[2px]"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="sidebar-glow absolute inset-y-0 left-0 flex w-72 animate-fade-up flex-col text-sidebar-foreground shadow-pop">
            <div className="flex items-center justify-between px-5 pb-3 pt-4">
              <BrandMark companyName={companyName} subtitle={t('shell.brandSub')} />
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label={t('shell.closeMenu')}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-sidebar-muted hover:bg-white/[0.06] hover:text-sidebar-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {nav}
            {sidebarFooter}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="z-20 flex h-14 shrink-0 items-center gap-2 border-b border-border/70 bg-card/80 px-3 backdrop-blur-md supports-[backdrop-filter]:bg-card/65 md:h-16 md:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label={t('shell.openMenu')}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm">
              <span className="hidden truncate text-muted-foreground sm:inline">{companyName}</span>
              {current ? (
                <>
                  <ChevronRight className="hidden h-3.5 w-3.5 text-muted-foreground/60 sm:inline" />
                  <span className="truncate font-semibold">{t(current.key)}</span>
                </>
              ) : (
                <span className="truncate font-semibold sm:hidden">{companyName}</span>
              )}
            </div>
            <div className="hidden text-2xs capitalize text-muted-foreground md:block">{today}</div>
          </div>
          <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void i18n.changeLanguage(i18n.language === 'fi' ? 'en' : 'fi')}
              // kept in English on purpose: a stable name in both languages (tests rely on it)
              aria-label="Switch language"
              title={t('shell.language')}
              className="h-9 gap-1.5 rounded-lg px-2.5 font-semibold"
            >
              <Languages className="h-4 w-4 text-muted-foreground" />
              {i18n.language === 'fi' ? 'EN' : 'FI'}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggle}
              aria-label={t('shell.toggleTheme')}
              title={t('shell.toggleTheme')}
              className="rounded-lg"
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <span aria-hidden className="mx-1 hidden h-6 w-px bg-border sm:block" />
            <div className="flex items-center gap-2.5 sm:pl-1">
              <span
                aria-hidden
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary/15 to-accent/20 text-xs font-semibold text-foreground ring-1 ring-border"
              >
                {initials(user?.name)}
              </span>
              <div className="hidden text-left leading-tight sm:block">
                <div className="max-w-[10rem] truncate text-[0.8rem] font-semibold">{user?.name}</div>
                <div className="text-2xs text-muted-foreground">
                  {t(`role.${user?.role ?? 'STAFF'}`)}
                </div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-lg text-muted-foreground hover:text-foreground"
              onClick={() => {
                void logout().then(() => navigate('/login'));
              }}
              aria-label={t('action.logout')}
              title={t('action.logout')}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>
        <main className="app-backdrop min-h-0 flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
