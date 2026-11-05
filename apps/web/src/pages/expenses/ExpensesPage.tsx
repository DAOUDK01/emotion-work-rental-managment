import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState, PageHeader, Segmented } from '@/components/ui/misc';
import { DuplicatesTab } from './DuplicatesTab';
import { ExpensesTab } from './ExpensesTab';
import { InvestmentsTab } from './InvestmentsTab';
import type { Lookups } from './types';

type Tab = 'expenses' | 'investments' | 'duplicates';

/** Expenses | Investments | Suspected duplicates. */
export default function ExpensesPage() {
  const { t } = useTranslation('expenses');
  const { user } = useAuth();
  const role = user?.role;
  const canWriteExpenses = role === 'ADMIN' || role === 'STAFF';
  const canSeeInvestments = role === 'ADMIN' || role === 'ACCOUNTANT';
  const canWriteInvestments = role === 'ADMIN';

  const [tab, setTab] = useState<Tab>('expenses');
  const [createExpense, setCreateExpense] = useState(0);
  const [createInvestment, setCreateInvestment] = useState(0);

  const lookups = useQuery({
    queryKey: ['lookups'],
    queryFn: () => api.get<Lookups>('/lookups'),
    staleTime: 5 * 60_000,
  });

  const activeTab: Tab = tab === 'investments' && !canSeeInvestments ? 'expenses' : tab;
  const tabs: Array<{ value: Tab; label: string }> = [
    { value: 'expenses', label: t('tabs.expenses') },
    ...(canSeeInvestments ? [{ value: 'investments' as const, label: t('tabs.investments') }] : []),
    { value: 'duplicates', label: t('tabs.duplicates') },
  ];

  const headerAction =
    activeTab === 'expenses' && canWriteExpenses ? (
      <Button onClick={() => setCreateExpense((n) => n + 1)} disabled={!lookups.data}>
        <Plus className="h-4 w-4" /> {t('actions.add')}
      </Button>
    ) : activeTab === 'investments' && canWriteInvestments ? (
      <Button onClick={() => setCreateInvestment((n) => n + 1)} disabled={!lookups.data}>
        <Plus className="h-4 w-4" /> {t('actions.addInvestment')}
      </Button>
    ) : null;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title={t('title')} description={t(`subtitle.${activeTab}`)} actions={headerAction} />

      <div className="overflow-x-auto">
        <Segmented value={activeTab} onChange={setTab} options={tabs} />
      </div>

      {lookups.isLoading ? (
        <LoadingState label={t('common:common.loading')} />
      ) : lookups.isError ? (
        <ErrorState error={lookups.error} onRetry={() => void lookups.refetch()} />
      ) : lookups.data ? (
        <div role="tabpanel" aria-label={tabs.find((x) => x.value === activeTab)?.label}>
          {activeTab === 'expenses' ? (
            <ExpensesTab lookups={lookups.data} canWrite={canWriteExpenses} createSignal={createExpense} />
          ) : activeTab === 'investments' ? (
            <InvestmentsTab lookups={lookups.data} canWrite={canWriteInvestments} createSignal={createInvestment} />
          ) : (
            <DuplicatesTab lookups={lookups.data} canWrite={canWriteExpenses} />
          )}
        </div>
      ) : null}
    </div>
  );
}
