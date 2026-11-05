import { useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Building2,
  FileText,
  Info,
  ListChecks,
  Mail,
  MessageCircle,
  Percent,
  Sheet,
  Upload,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/misc';
import { cn } from '@/components/ui/utils';
import CompanyTab from './CompanyTab';
import InvoiceTab from './InvoiceTab';
import RatesTab from './RatesTab';
import ListsTab from './ListsTab';
import UsersTab from './UsersTab';
import PosCashTab from './PosCashTab';
import WhatsAppTab from './WhatsAppTab';
import SheetsTab from './SheetsTab';
import EmailTab from './EmailTab';
import ImportTab from './ImportTab';
import AboutTab from './AboutTab';

const TABS = [
  { key: 'company', icon: Building2 },
  { key: 'invoice', icon: FileText },
  { key: 'rates', icon: Percent },
  { key: 'lists', icon: ListChecks },
  { key: 'users', icon: Users },
  { key: 'pos', icon: Wallet },
  { key: 'whatsapp', icon: MessageCircle },
  { key: 'sheets', icon: Sheet },
  { key: 'email', icon: Mail },
  { key: 'import', icon: Upload },
  { key: 'about', icon: Info },
] as const satisfies ReadonlyArray<{ key: string; icon: LucideIcon }>;

type TabKey = (typeof TABS)[number]['key'];

function isTabKey(v: string | null): v is TabKey {
  return TABS.some((tab) => tab.key === v);
}

export default function SettingsPage() {
  const { t } = useTranslation('settings');
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const active: TabKey = isTabKey(raw) ? raw : 'company';
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (key: TabKey) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', key);
        return next;
      },
      { replace: true },
    );
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    select(TABS[next].key);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title={t('page.title')} description={t('page.description')} />
      <div className="grid gap-4 md:grid-cols-[13rem_1fr]">
        <nav aria-label={t('page.tabsLabel')} className="md:sticky md:top-4 md:self-start">
          <div
            role="tablist"
            aria-orientation="vertical"
            className="flex gap-1 overflow-x-auto rounded-lg border bg-card p-1 md:flex-col md:overflow-visible"
          >
            {TABS.map((tab, i) => {
              const Icon = tab.icon;
              const selected = tab.key === active;
              return (
                <button
                  key={tab.key}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`settings-tab-${tab.key}`}
                  aria-selected={selected}
                  aria-controls={`settings-panel-${tab.key}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => select(tab.key)}
                  onKeyDown={(e) => onKeyDown(e, i)}
                  className={cn(
                    'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    selected
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  {t(`tabs.${tab.key}`)}
                </button>
              );
            })}
          </div>
        </nav>
        <section
          role="tabpanel"
          id={`settings-panel-${active}`}
          aria-labelledby={`settings-tab-${active}`}
          className="min-w-0"
        >
          {active === 'company' ? <CompanyTab /> : null}
          {active === 'invoice' ? <InvoiceTab /> : null}
          {active === 'rates' ? <RatesTab /> : null}
          {active === 'lists' ? <ListsTab /> : null}
          {active === 'users' ? <UsersTab /> : null}
          {active === 'pos' ? <PosCashTab /> : null}
          {active === 'whatsapp' ? <WhatsAppTab /> : null}
          {active === 'sheets' ? <SheetsTab /> : null}
          {active === 'email' ? <EmailTab /> : null}
          {active === 'import' ? <ImportTab /> : null}
          {active === 'about' ? <AboutTab /> : null}
        </section>
      </div>
    </div>
  );
}
