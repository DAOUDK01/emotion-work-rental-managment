import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  BadgeEuro,
  Banknote,
  Bike,
  ChartColumnBig,
  ClipboardList,
  FileText,
  Handshake,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareText,
  Moon,
  Package,
  PlusCircle,
  Receipt,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sun,
  Users,
  Wallet,
  Wrench,
  X,
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

const NAV: NavItem[] = [
  { to: '/', icon: LayoutDashboard, key: 'nav.dashboard' },
  { to: '/entry', icon: PlusCircle, key: 'nav.addEntry', roles: ['ADMIN', 'STAFF'] },
  { to: '/pos', icon: ShoppingCart, key: 'nav.pos', roles: ['ADMIN', 'STAFF'] },
  { to: '/invoices', icon: FileText, key: 'nav.invoices' },
  { to: '/rentals', icon: KeyRound, key: 'nav.rentals' },
  { to: '/units', icon: Bike, key: 'nav.units' },
  { to: '/inventory', icon: Package, key: 'nav.inventory' },
  { to: '/customers', icon: Users, key: 'nav.customers' },
  { to: '/expenses', icon: Receipt, key: 'nav.expenses' },
  { to: '/vat', icon: BadgeEuro, key: 'nav.vat' },
  { to: '/partners', icon: Handshake, key: 'nav.partners', roles: ['ADMIN', 'ACCOUNTANT'] },
  { to: '/cash', icon: Wallet, key: 'nav.cash', roles: ['ADMIN', 'ACCOUNTANT'] },
  { to: '/reports', icon: ChartColumnBig, key: 'nav.reports' },
  { to: '/whatsapp', icon: MessageSquareText, key: 'nav.whatsapp', roles: ['ADMIN'] },
  { to: '/claims', icon: ShieldCheck, key: 'nav.claims' },
  { to: '/contracts', icon: Wrench, key: 'nav.contracts', roles: ['ADMIN', 'ACCOUNTANT'] },
  { to: '/settings', icon: Settings, key: 'nav.settings', roles: ['ADMIN'] },
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

export function AppShell() {
  const { t, i18n } = useTranslation('common');
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { dark, toggle } = useDarkMode();

  const { data: settings } = useQuery({
    queryKey: ['settings', 'app'],
    queryFn: () => api.get<{ settings: { company?: { name?: string } } }>('/settings/app'),
    staleTime: 5 * 60 * 1000,
  });
  const companyName = settings?.settings.company?.name ?? 'E Motion Works Oy';

  const items = NAV.filter((n) => !n.roles || (user && n.roles.includes(user.role)));

  const nav = (
    <nav className="flex-1 space-y-0.5 overflow-y-auto p-2 scrollbar-thin" aria-label="Main">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          onClick={() => setMobileOpen(false)}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )
          }
        >
          <item.icon className="h-4 w-4 shrink-0" />
          {t(item.key)}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex h-screen overflow-hidden">
      {/* desktop sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col border-r bg-card md:flex">
        <div className="flex items-center gap-2 border-b px-4 py-3.5">
          <ClipboardList className="h-5 w-5 text-accent" />
          <div className="truncate text-sm font-bold leading-tight">{companyName}</div>
        </div>
        {nav}
      </aside>

      {/* mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col border-r bg-card shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-bold">{companyName}</span>
              <Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)} aria-label="Close menu">
                <X className="h-4 w-4" />
              </Button>
            </div>
            {nav}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-3 md:px-5">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="truncate text-sm font-semibold md:hidden">{companyName}</div>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void i18n.changeLanguage(i18n.language === 'fi' ? 'en' : 'fi')}
              aria-label="Switch language"
              className="font-semibold"
            >
              {i18n.language === 'fi' ? 'EN' : 'FI'}
            </Button>
            <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle dark mode">
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <div className="mx-1 hidden text-right sm:block">
              <div className="text-xs font-semibold leading-tight">{user?.name}</div>
              <div className="text-2xs text-muted-foreground">{t(`role.${user?.role ?? 'STAFF'}`)}</div>
            </div>
            <Button
              variant="ghost"
              size="icon"
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
        <main className="min-h-0 flex-1 overflow-y-auto p-3 md:p-5">
          <Outlet />
        </main>
        <div className="border-t bg-card px-4 py-1 text-center text-2xs text-muted-foreground">
          <Banknote className="mr-1 inline h-3 w-3" />
          {t('footer.tagline')}
        </div>
      </div>
    </div>
  );
}
