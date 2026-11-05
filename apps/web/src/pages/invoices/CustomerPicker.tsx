import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/misc';
import { cn } from '@/components/ui/utils';
import { SearchCombobox } from './SearchCombobox';
import type { CustomerHit, InvoiceLanguage } from './types';

export interface PickedCustomer {
  id: number;
  name: string;
  type?: 'INDIVIDUAL' | 'BUSINESS';
  email?: string | null;
  language?: InvoiceLanguage;
}

/** Required customer select with server-side search (name, email, Business ID). */
export function CustomerPicker({
  id,
  value,
  onChange,
  invalid,
  disabled,
}: {
  id?: string;
  value: PickedCustomer | null;
  onChange: (customer: PickedCustomer | null) => void;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation('invoices');

  if (value) {
    return (
      <div
        className={cn(
          'flex h-9 items-center justify-between gap-2 rounded-md border border-input bg-card pl-3 pr-1 text-sm shadow-sm',
          invalid && 'border-destructive',
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{value.name}</span>
          {value.type ? (
            <Badge variant={value.type === 'BUSINESS' ? 'info' : 'default'}>{t(`customerType.${value.type}`)}</Badge>
          ) : null}
        </div>
        {disabled ? null : (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label={t('editor.changeCustomer')}
            onClick={() => onChange(null)}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <SearchCombobox<CustomerHit>
      id={id}
      ariaLabel={t('editor.customer')}
      placeholder={t('editor.customerSearch')}
      invalid={invalid}
      queryKey={(term) => ['customers', 'list', 'invoice-picker', term]}
      fetcher={async (term) =>
        (
          await api.get<{ customers: CustomerHit[] }>(
            '/customers' + qs({ q: term || undefined, archived: 'false', pageSize: 10 }),
          )
        ).customers
      }
      itemKey={(c) => c.id}
      renderItem={(c) => (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate font-medium">{c.name}</div>
            <div className="truncate text-2xs text-muted-foreground">
              {[c.businessId, c.email, c.city].filter(Boolean).join(' · ') || t(`customerType.${c.type}`)}
            </div>
          </div>
          <Badge variant="outline">{c.language}</Badge>
        </div>
      )}
      onPick={(c) => onChange({ id: c.id, name: c.name, type: c.type, email: c.email, language: c.language })}
      emptyText={t('editor.noCustomers')}
    />
  );
}
