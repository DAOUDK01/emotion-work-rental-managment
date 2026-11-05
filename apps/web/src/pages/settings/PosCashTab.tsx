import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Field, Input } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingState, Segmented } from '@/components/ui/misc';
import {
  type AllSettings,
  type PnlSettings,
  SectionTitle,
  type SettingKey,
  type VocabHolder,
  useSaveSettings,
  useVocab,
  WithSettings,
} from './shared';

export default function PosCashTab() {
  return <WithSettings>{(s) => <PosCashForm settings={s} />}</WithSettings>;
}

interface State {
  receiptWidthMm: 58 | 80;
  askCustomer: boolean;
  alertAfterDays: string;
  byHolder: Record<string, boolean>;
  countUnitPurchasesAsCost: boolean;
  allocateSharedCostsByRevenue: boolean;
  partnerPayableForPersonalSpend: boolean;
  subtractRepairPartsFromPayback: boolean;
}

function initialState(s: AllSettings): State {
  return {
    receiptWidthMm: s.pos?.receiptWidthMm === 58 ? 58 : 80,
    askCustomer: s.pos?.askCustomer ?? false,
    alertAfterDays: String(s.cash?.alertAfterDays ?? 7),
    byHolder: { ...(s.vatDefaults?.byHolder ?? {}) },
    countUnitPurchasesAsCost: s.pnl?.countUnitPurchasesAsCost ?? false,
    allocateSharedCostsByRevenue: s.pnl?.allocateSharedCostsByRevenue ?? false,
    partnerPayableForPersonalSpend: s.pnl?.partnerPayableForPersonalSpend ?? true,
    subtractRepairPartsFromPayback: s.units?.subtractRepairPartsFromPayback ?? false,
  };
}

function PosCashForm({ settings }: { settings: AllSettings }) {
  const { t } = useTranslation('settings');
  const save = useSaveSettings();
  const holders = useVocab<VocabHolder>('holders', 'holders');
  const initial = useMemo(() => initialState(settings), [settings]);
  const [state, setState] = useState<State>(initial);
  const [baseline, setBaseline] = useState<State>(initial);

  const set = <K extends keyof State>(key: K, value: State[K]) => setState((s) => ({ ...s, [key]: value }));

  const daysValid = /^\d{1,3}$/.test(state.alertAfterDays.trim()) && Number(state.alertAfterDays) >= 1;
  const dirty = JSON.stringify(state) !== JSON.stringify(baseline);

  const onSave = () => {
    if (!daysValid) return;
    const items: Array<{ key: SettingKey; value: unknown }> = [];
    if (state.receiptWidthMm !== baseline.receiptWidthMm || state.askCustomer !== baseline.askCustomer) {
      items.push({
        key: 'pos',
        value: { ...settings.pos, receiptWidthMm: state.receiptWidthMm, askCustomer: state.askCustomer },
      });
    }
    if (state.alertAfterDays !== baseline.alertAfterDays) {
      items.push({ key: 'cash', value: { ...settings.cash, alertAfterDays: Number(state.alertAfterDays) } });
    }
    if (JSON.stringify(state.byHolder) !== JSON.stringify(baseline.byHolder)) {
      items.push({ key: 'vatDefaults', value: { ...settings.vatDefaults, byHolder: state.byHolder } });
    }
    const pnlKeys: Array<keyof PnlSettings> = [
      'countUnitPurchasesAsCost',
      'allocateSharedCostsByRevenue',
      'partnerPayableForPersonalSpend',
    ];
    if (pnlKeys.some((k) => state[k] !== baseline[k])) {
      items.push({
        key: 'pnl',
        value: {
          ...settings.pnl,
          countUnitPurchasesAsCost: state.countUnitPurchasesAsCost,
          allocateSharedCostsByRevenue: state.allocateSharedCostsByRevenue,
          partnerPayableForPersonalSpend: state.partnerPayableForPersonalSpend,
        },
      });
    }
    if (state.subtractRepairPartsFromPayback !== baseline.subtractRepairPartsFromPayback) {
      items.push({
        key: 'units',
        value: { ...settings.units, subtractRepairPartsFromPayback: state.subtractRepairPartsFromPayback },
      });
    }
    if (!items.length) return;
    const saved = state;
    save.mutate(items, { onSuccess: () => setBaseline(saved) });
  };

  const activeHolders = (holders.data ?? []).filter((h) => h.active);

  return (
    <div className="space-y-4">
      <SectionTitle title={t('pos.title')} description={t('pos.description')} />

      <Card>
        <CardHeader>
          <CardTitle>{t('pos.receiptTitle')}</CardTitle>
          <CardDescription>{t('pos.receiptHint')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <p className="text-xs font-medium" id="receipt-width-label">
              {t('pos.receiptWidth')}
            </p>
            <div aria-labelledby="receipt-width-label">
              <Segmented
                size="sm"
                value={state.receiptWidthMm}
                onChange={(v) => set('receiptWidthMm', v)}
                options={[
                  { value: 58 as const, label: '58 mm' },
                  { value: 80 as const, label: '80 mm' },
                ]}
              />
            </div>
          </div>
          <ToggleRow
            label={t('pos.askCustomer')}
            hint={t('pos.askCustomerHint')}
            checked={state.askCustomer}
            onChange={(v) => set('askCustomer', v)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('pos.cashTitle')}</CardTitle>
          <CardDescription>{t('pos.cashHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Field
            label={t('pos.alertAfterDays')}
            error={daysValid ? undefined : t('validation.daysRange', { min: 1 })}
            hint={t('pos.alertAfterDaysHint')}
            className="max-w-xs"
            required
          >
            <Input
              inputMode="numeric"
              value={state.alertAfterDays}
              onChange={(e) => set('alertAfterDays', e.target.value)}
              aria-invalid={!daysValid}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('pos.vatDefaultsTitle')}</CardTitle>
          <CardDescription>{t('pos.vatDefaultsHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          {holders.isLoading ? (
            <LoadingState />
          ) : holders.isError ? (
            <ErrorState error={holders.error} onRetry={() => void holders.refetch()} />
          ) : !activeHolders.length ? (
            <EmptyState title={t('pos.noHolders')} hint={t('pos.noHoldersHint')} />
          ) : (
            <fieldset>
              <legend className="sr-only">{t('pos.vatDefaultsTitle')}</legend>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {activeHolders.map((h) => (
                  <div key={h.id} className="rounded-md border p-3">
                    <Checkbox
                      label={h.name}
                      checked={state.byHolder[h.name] ?? false}
                      onChange={(e) => set('byHolder', { ...state.byHolder, [h.name]: e.target.checked })}
                    />
                    <p className="mt-1 pl-6 text-2xs text-muted-foreground">
                      {t(`kind.${h.kind}`)} ·{' '}
                      {(state.byHolder[h.name] ?? false) ? t('pos.defaultYes') : t('pos.defaultNo')}
                    </p>
                  </div>
                ))}
              </div>
            </fieldset>
          )}
          <p className="mt-3 text-2xs text-muted-foreground">{t('common:money.vatWarning')}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('pos.pnlTitle')}</CardTitle>
          <CardDescription>{t('pos.pnlHint')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ToggleRow
            label={t('pos.countUnitPurchases')}
            hint={t('pos.countUnitPurchasesHint')}
            checked={state.countUnitPurchasesAsCost}
            onChange={(v) => set('countUnitPurchasesAsCost', v)}
          />
          <ToggleRow
            label={t('pos.allocateShared')}
            hint={t('pos.allocateSharedHint')}
            checked={state.allocateSharedCostsByRevenue}
            onChange={(v) => set('allocateSharedCostsByRevenue', v)}
          />
          <ToggleRow
            label={t('pos.partnerPayable')}
            hint={t('pos.partnerPayableHint')}
            checked={state.partnerPayableForPersonalSpend}
            onChange={(v) => set('partnerPayableForPersonalSpend', v)}
          />
          <ToggleRow
            label={t('pos.subtractParts')}
            hint={t('pos.subtractPartsHint')}
            checked={state.subtractRepairPartsFromPayback}
            onChange={(v) => set('subtractRepairPartsFromPayback', v)}
          />
        </CardContent>
      </Card>

      <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-background/95 py-3 backdrop-blur">
        {dirty ? <span className="mr-auto self-center text-xs text-muted-foreground">{t('form.unsaved')}</span> : null}
        <Button variant="outline" onClick={() => setState(baseline)} disabled={!dirty || save.isPending}>
          {t('form.discard')}
        </Button>
        <Button onClick={onSave} disabled={!dirty || !daysValid || save.isPending}>
          {t('common:action.save')}
        </Button>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="rounded-md border p-3">
      <Checkbox label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <p className="mt-1 pl-6 text-2xs text-muted-foreground">{hint}</p>
    </div>
  );
}
