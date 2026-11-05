import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { EmptyState, ErrorState, LoadingState, PageHeader, Segmented } from '@/components/ui/misc';
import { ExpenseForm } from './ExpenseForm';
import { IncomeForm } from './IncomeForm';
import { InvestmentForm } from './InvestmentForm';
import { LatestEntries } from './LatestEntries';
import type { Lookups } from './types';

type Tab = 'income' | 'expense' | 'investment';
const TABS: Tab[] = ['income', 'expense', 'investment'];

/** "Add entry" — PDF Figure 2: Income / Expense / Investment quick entry + latest entries. */
export default function QuickEntryPage() {
  const { t } = useTranslation('entry');
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [params, setParams] = useSearchParams();

  const requested = params.get('tab');
  const tab: Tab =
    requested && (TABS as string[]).includes(requested) && (requested !== 'investment' || isAdmin)
      ? (requested as Tab)
      : 'income';
  const setTab = (next: Tab) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next === 'income') p.delete('tab');
        else p.set('tab', next);
        return p;
      },
      { replace: true },
    );

  const lookups = useQuery({
    queryKey: ['lookups'],
    queryFn: () => api.get<Lookups>('/lookups'),
    staleTime: 5 * 60_000,
  });

  const tabOptions: Array<{ value: Tab; label: string }> = [
    { value: 'income', label: t('tabs.income') },
    { value: 'expense', label: t('tabs.expense') },
    ...(isAdmin ? [{ value: 'investment' as const, label: t('tabs.investment') }] : []),
  ];

  const l = lookups.data;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title={t('title')} description={t('subtitle')} />

      <Segmented value={tab} onChange={setTab} options={tabOptions} />

      {lookups.isLoading ? (
        <LoadingState label={t('common:common.loading')} />
      ) : lookups.isError || !l ? (
        <ErrorState error={lookups.error} onRetry={() => void lookups.refetch()} />
      ) : (
        <>
          {/* all tabs stay mounted so switching never loses a half-typed form */}
          <section aria-label={t('tabs.income')} hidden={tab !== 'income'}>
            {l.models.length === 0 ? (
              <EmptyState title={t('empty.noModelsTitle')} hint={t('empty.noModelsHint')} />
            ) : (
              <IncomeForm lookups={l} />
            )}
          </section>
          <section aria-label={t('tabs.expense')} hidden={tab !== 'expense'}>
            {l.expenseCategories.length === 0 ? (
              <EmptyState title={t('empty.noCategoriesTitle')} hint={t('empty.noCategoriesHint')} />
            ) : (
              <ExpenseForm lookups={l} />
            )}
          </section>
          {isAdmin ? (
            <section aria-label={t('tabs.investment')} hidden={tab !== 'investment'}>
              <InvestmentForm lookups={l} />
            </section>
          ) : null}
        </>
      )}

      <LatestEntries />
    </div>
  );
}
