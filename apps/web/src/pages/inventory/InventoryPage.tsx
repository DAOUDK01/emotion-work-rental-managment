import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth';
import { PageHeader, Segmented } from '@/components/ui/misc';
import { LowStockTab } from './LowStockTab';
import { MovementsTab } from './MovementsTab';
import { ProductsTab } from './ProductsTab';
import { ReceivingTab } from './ReceivingTab';
import type { Product } from './types';

type Tab = 'products' | 'receiving' | 'movements' | 'low';
const TABS: Tab[] = ['products', 'receiving', 'movements', 'low'];

/** Inventory: product catalogue, goods receiving (scan-first), stock movements, low stock + valuation. */
export default function InventoryPage() {
  const { t } = useTranslation('inventory');
  const { user } = useAuth();
  const canWrite = user?.role === 'ADMIN' || user?.role === 'STAFF';
  const [params, setParams] = useSearchParams();
  const [receiveProduct, setReceiveProduct] = useState<Product | null>(null);

  const requested = params.get('tab') as Tab | null;
  const available = canWrite ? TABS : TABS.filter((x) => x !== 'receiving');
  const tab: Tab = requested && available.includes(requested) ? requested : 'products';

  const setTab = useCallback(
    (next: Tab) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === 'products') p.delete('tab');
          else p.set('tab', next);
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const receive = useCallback(
    (product: Product) => {
      setReceiveProduct(product);
      setTab('receiving');
    },
    [setTab],
  );
  const clearPreselected = useCallback(() => setReceiveProduct(null), []);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title={t('title')} description={t('subtitle')} />
      <div className="overflow-x-auto">
        <Segmented
          value={tab}
          onChange={setTab}
          options={available.map((value) => ({ value, label: t(`tabs.${value}`) }))}
        />
      </div>
      <div role="tabpanel" aria-label={t(`tabs.${tab}`)}>
        {tab === 'products' ? <ProductsTab canWrite={canWrite} /> : null}
        {tab === 'receiving' && canWrite ? (
          <ReceivingTab preselected={receiveProduct} onPreselectedUsed={clearPreselected} />
        ) : null}
        {tab === 'movements' ? <MovementsTab canWrite={canWrite} /> : null}
        {tab === 'low' ? <LowStockTab canWrite={canWrite} onReceive={receive} /> : null}
      </div>
    </div>
  );
}
