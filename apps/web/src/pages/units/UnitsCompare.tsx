import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';
import { fmtEUR, fmtPct } from '@/lib/format';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TH, THead, TR } from '@/components/ui/table';
import { HBars } from '@/components/charts';
import type { CompareRow } from './types';

/** "Compare types" view — earned by category chart + the numbers behind it. */
export default function UnitsCompare({
  query,
}: {
  query: UseQueryResult<{ byCategory: CompareRow[] }>;
}) {
  const { t } = useTranslation('units');

  if (query.isLoading) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const rows = query.data?.byCategory ?? [];
  if (rows.length === 0) {
    return <EmptyState title={t('compare.emptyTitle')} hint={t('compare.emptyHint')} />;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('compare.chartTitle')}</CardTitle>
          <CardDescription>{t('compare.chartHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <HBars
            data={rows.map((r) => ({ label: t(`category.${r.category}`), value: r.earnedCents }))}
            color="#2a9d8f"
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('compare.tableTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR>
                <TH>{t('table.category')}</TH>
                <TH className="text-right">{t('compare.units')}</TH>
                <TH className="text-right">{t('table.cost')}</TH>
                <TH className="text-right">{t('table.earned')}</TH>
                <TH className="text-right">{t('table.payback')}</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.category}>
                  <TD className="font-medium">{t(`category.${r.category}`)}</TD>
                  <TD className="text-right tabular-nums">{r.unitCount}</TD>
                  <TDMoney>{fmtEUR(r.costCents)}</TDMoney>
                  <TDMoney>{fmtEUR(r.earnedCents)}</TDMoney>
                  <TD className="text-right tabular-nums">
                    {r.paybackPct === null ? '–' : fmtPct(r.paybackPct)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
