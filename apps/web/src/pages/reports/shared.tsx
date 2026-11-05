import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/misc';

/**
 * Renders the three data states of a report query (loading / error / empty) and hands the
 * loaded data to `children` otherwise. Background refetches keep the old data on screen.
 */
export function QueryView<T>({
  query,
  isEmpty,
  emptyTitle,
  emptyHint,
  children,
}: {
  query: UseQueryResult<T>;
  isEmpty: (data: T) => boolean;
  emptyTitle: string;
  emptyHint?: string;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const data = query.data;
  if (isEmpty(data)) return <EmptyState title={emptyTitle} hint={emptyHint} />;
  return <>{children(data)}</>;
}

/** Costs shown as negative amounts on statements (avoids printing "−0"). */
export function neg(cents: number): number {
  return cents === 0 ? 0 : -cents;
}

/** Share of a total as a percentage, null when the total is zero. */
export function sharePct(part: number, total: number): number | null {
  return total === 0 ? null : (part / total) * 100;
}
