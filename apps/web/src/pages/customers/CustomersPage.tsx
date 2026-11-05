import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { UserPlus } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtEUR, fmtNumber } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Badge, EmptyState, ErrorState, LoadingState, PageHeader, Segmented } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TH, THead, TR } from '@/components/ui/table';
import CustomerDetailDrawer from './CustomerDetailDrawer';
import CustomerFormDialog from './CustomerFormDialog';
import { CUSTOMER_TYPES, hasPhoneField, type Customer, type CustomerListResponse, type CustomerType } from './types';

const PAGE_SIZE = 50;

type ArchivedFilter = 'false' | 'true' | 'all';

export default function CustomersPage() {
  const { t } = useTranslation('customers');
  const { user } = useAuth();
  const canWrite = user?.role === 'ADMIN' || user?.role === 'STAFF';

  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [type, setType] = useState<'' | CustomerType>('');
  const [archived, setArchived] = useState<ArchivedFilter>('false');
  const [page, setPage] = useState(1);

  const [detailId, setDetailId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(handle);
  }, [search]);

  const filtersQs = useMemo(
    () =>
      qs({
        q: q || undefined,
        type: type || undefined,
        archived: archived === 'all' ? undefined : archived,
        page,
        pageSize: PAGE_SIZE,
      }),
    [q, type, archived, page],
  );

  const list = useQuery({
    queryKey: ['customers', 'list', filtersQs],
    queryFn: () => api.get<CustomerListResponse>('/customers' + filtersQs),
  });

  const rows = list.data?.customers ?? [];
  const total = list.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = q !== '' || type !== '' || archived !== 'false';
  // GDPR: the API only sends the phone field to admins — show the column only when it exists.
  const showPhone = rows.some(hasPhoneField);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (customer: Customer) => {
    setEditing(customer);
    setFormOpen(true);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canWrite ? (
            <Button onClick={openCreate}>
              <UserPlus className="h-4 w-4" /> {t('actions.new')}
            </Button>
          ) : undefined
        }
      />

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          className="h-8 w-full text-xs sm:w-64"
          placeholder={t('filters.searchPlaceholder')}
          aria-label={t('common:action.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          aria-label={t('filters.type')}
          className="h-8 w-40 text-xs"
          value={type}
          onChange={(e) => {
            setType(e.target.value as '' | CustomerType);
            setPage(1);
          }}
        >
          <option value="">{t('filters.allTypes')}</option>
          {CUSTOMER_TYPES.map((ct) => (
            <option key={ct} value={ct}>
              {t(`type.${ct}`)}
            </option>
          ))}
        </Select>
        <Segmented
          size="sm"
          value={archived}
          onChange={(v) => {
            setArchived(v);
            setPage(1);
          }}
          options={[
            { value: 'false' as const, label: t('filters.active') },
            { value: 'true' as const, label: t('filters.archived') },
            { value: 'all' as const, label: t('common:common.all') },
          ]}
        />
        {list.data ? (
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {t('filters.count', { formatted: fmtNumber(total) })}
          </span>
        ) : null}
      </div>

      {list.isLoading ? <LoadingState /> : null}
      {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.data && rows.length === 0 ? (
        <EmptyState
          title={hasFilters ? t('empty.filtered') : t('empty.title')}
          hint={hasFilters ? t('empty.filteredHint') : t('empty.hint')}
          action={
            canWrite && !hasFilters ? (
              <Button onClick={openCreate}>
                <UserPlus className="h-4 w-4" /> {t('actions.new')}
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {rows.length > 0 ? (
        <Table>
          <THead>
            <TR>
              <TH>{t('table.name')}</TH>
              <TH>{t('table.type')}</TH>
              <TH>{t('table.email')}</TH>
              {showPhone ? <TH>{t('table.phone')}</TH> : null}
              <TH className="text-right">{t('table.outstanding')}</TH>
              <TH className="text-right">{t('table.rentals')}</TH>
              <TH className="text-right">{t('table.invoices')}</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((c) => (
              <TR
                key={c.id}
                tabIndex={0}
                className="cursor-pointer focus-visible:bg-muted/60 focus-visible:outline-none"
                onClick={() => setDetailId(c.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setDetailId(c.id);
                  }
                }}
                aria-label={t('table.open', { name: c.name })}
              >
                <TD>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{c.name}</span>
                    {c.archived ? <Badge variant="default">{t('detail.archived')}</Badge> : null}
                  </div>
                  {c.businessId ? (
                    <span className="block text-2xs text-muted-foreground tabular-nums">
                      {t('table.businessIdShort')} {c.businessId}
                    </span>
                  ) : null}
                </TD>
                <TD>
                  <Badge variant={c.type === 'BUSINESS' ? 'navy' : 'default'}>{t(`type.${c.type}`)}</Badge>
                </TD>
                <TD className="max-w-[14rem]">
                  <span className="block truncate" title={c.email ?? undefined}>
                    {c.email ?? '–'}
                  </span>
                </TD>
                {showPhone ? <TD className="whitespace-nowrap">{c.phone ?? '–'}</TD> : null}
                <TDMoney className={c.outstandingCents > 0 ? 'font-semibold text-loss' : undefined}>
                  {fmtEUR(c.outstandingCents)}
                </TDMoney>
                <TD className="text-right tabular-nums">{c.rentalCount}</TD>
                <TD className="text-right tabular-nums">{c.invoiceCount}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : null}

      {total > PAGE_SIZE ? (
        <div className="flex items-center justify-end gap-2 text-xs">
          <span className="text-muted-foreground">
            {t('common:common.page')} {page} {t('common:common.of')} {pageCount}
          </span>
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t('common:action.back')}
          </Button>
          <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
            {t('common:action.next')}
          </Button>
        </div>
      ) : null}

      <CustomerDetailDrawer customerId={detailId} onClose={() => setDetailId(null)} onEdit={openEdit} />
      <CustomerFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        customer={editing}
        onCreated={(c) => setDetailId(c.id)}
      />
    </div>
  );
}
