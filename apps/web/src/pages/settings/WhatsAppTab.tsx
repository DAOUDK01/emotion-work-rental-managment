import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CheckCircle2, Copy, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Checkbox, Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/misc';
import { type AllSettings, SectionTitle, useSaveSettings, WithSettings } from './shared';

const E164 = /^\+[1-9]\d{6,14}$/;
const ENV_VARS = [
  'WHATSAPP_VERIFY_TOKEN',
  'WHATSAPP_APP_SECRET',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
] as const;

/** "+358 40 123 4567" → "+358401234567" */
function normalizeNumber(v: string): string {
  const trimmed = v.trim().replace(/[\s()-]/g, '');
  return trimmed.startsWith('00') ? `+${trimmed.slice(2)}` : trimmed;
}

export default function WhatsAppTab() {
  const { t } = useTranslation('settings');
  return (
    <div className="space-y-4">
      <SectionTitle title={t('whatsapp.title')} description={t('whatsapp.description')} />
      <WithSettings>
        {(s) => (
          <>
            <AllowListCard settings={s} />
            <DailySummaryCard settings={s} />
          </>
        )}
      </WithSettings>
      <WebhookCard />
    </div>
  );
}

function AllowListCard({ settings }: { settings: AllSettings }) {
  const { t } = useTranslation('settings');
  const save = useSaveSettings();
  const saved = useMemo(() => settings['whatsapp.allowedNumbers'] ?? [], [settings]);
  const [numbers, setNumbers] = useState<string[]>(saved);
  const [baseline, setBaseline] = useState<string[]>(saved);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);

  const invalid = numbers.map((n) => !E164.test(normalizeNumber(n)));
  const dirty = JSON.stringify(numbers) !== JSON.stringify(baseline);

  const addDraft = () => {
    const n = normalizeNumber(draft);
    if (!E164.test(n)) {
      setDraftError(t('whatsapp.invalidNumber'));
      return;
    }
    if (numbers.map(normalizeNumber).includes(n)) {
      setDraftError(t('whatsapp.duplicateNumber'));
      return;
    }
    setNumbers((list) => [...list, n]);
    setDraft('');
    setDraftError(null);
  };

  const onSave = () => {
    if (invalid.some(Boolean)) {
      toast.error(t('whatsapp.fixInvalid'));
      return;
    }
    const cleaned = [...new Set(numbers.map(normalizeNumber))];
    save.mutate([{ key: 'whatsapp.allowedNumbers', value: cleaned }], {
      onSuccess: () => {
        setNumbers(cleaned);
        setBaseline(cleaned);
      },
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('whatsapp.allowedTitle')}</CardTitle>
        <CardDescription>{t('whatsapp.allowedHint')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {numbers.length === 0 ? (
          <EmptyState title={t('whatsapp.noNumbers')} hint={t('whatsapp.noNumbersHint')} />
        ) : (
          <ul className="space-y-2">
            {numbers.map((n, i) => (
              <li key={i} className="flex items-start gap-2">
                <div className="flex-1">
                  <Input
                    value={n}
                    inputMode="tel"
                    aria-label={t('whatsapp.numberAria', { index: i + 1 })}
                    aria-invalid={invalid[i]}
                    className={invalid[i] ? 'border-destructive font-mono' : 'font-mono'}
                    onChange={(e) => {
                      const v = e.target.value;
                      setNumbers((list) => list.map((x, j) => (j === i ? v : x)));
                    }}
                  />
                  {invalid[i] ? (
                    <p className="mt-1 text-2xs font-medium text-destructive">{t('whatsapp.invalidNumber')}</p>
                  ) : null}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('whatsapp.removeAria', { number: n })}
                  title={t('whatsapp.remove')}
                  onClick={() => setRemoving(i)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-start"
          onSubmit={(e) => {
            e.preventDefault();
            addDraft();
          }}
          noValidate
        >
          <div className="flex-1">
            <Input
              value={draft}
              inputMode="tel"
              placeholder="+358401234567"
              aria-label={t('whatsapp.newNumber')}
              aria-invalid={draftError !== null}
              className="font-mono"
              onChange={(e) => {
                setDraft(e.target.value);
                setDraftError(null);
              }}
            />
            {draftError ? (
              <p className="mt-1 text-2xs font-medium text-destructive">{draftError}</p>
            ) : (
              <p className="mt-1 text-2xs text-muted-foreground">{t('whatsapp.formatHint')}</p>
            )}
          </div>
          <Button type="submit" variant="outline" disabled={!draft.trim()}>
            <Plus className="h-4 w-4" /> {t('whatsapp.addNumber')}
          </Button>
        </form>

        <div className="flex justify-end gap-2 border-t pt-3">
          {dirty ? <span className="mr-auto self-center text-xs text-muted-foreground">{t('form.unsaved')}</span> : null}
          <Button variant="outline" onClick={() => setNumbers(baseline)} disabled={!dirty || save.isPending}>
            {t('form.discard')}
          </Button>
          <Button onClick={onSave} disabled={!dirty || save.isPending}>
            {t('common:action.save')}
          </Button>
        </div>
      </CardContent>
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t('whatsapp.remove')}
        message={t('whatsapp.removeConfirm', { number: removing !== null ? numbers[removing] ?? '' : '' })}
        confirmLabel={t('whatsapp.remove')}
        onConfirm={() => {
          if (removing !== null) setNumbers((list) => list.filter((_, j) => j !== removing));
          setRemoving(null);
        }}
      />
    </Card>
  );
}

function DailySummaryCard({ settings }: { settings: AllSettings }) {
  const { t } = useTranslation('settings');
  const save = useSaveSettings();
  const current = settings.whatsapp?.dailySummary ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('whatsapp.summaryTitle')}</CardTitle>
        <CardDescription>{t('whatsapp.summaryHint')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Checkbox
          label={t('whatsapp.dailySummary')}
          checked={current}
          disabled={save.isPending}
          onChange={(e) =>
            save.mutate([
              {
                key: 'whatsapp',
                value: { groupFeatureFlag: false, ...settings.whatsapp, dailySummary: e.target.checked },
              },
            ])
          }
        />
      </CardContent>
    </Card>
  );
}

function WebhookCard() {
  const { t } = useTranslation('settings');
  const apiBase = (import.meta.env.VITE_API_URL as string | undefined) || window.location.origin;
  const url = `${apiBase.replace(/\/$/, '')}/api/whatsapp/webhook`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('whatsapp.copied'));
    } catch {
      toast.error(t('whatsapp.copyFailed'));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('whatsapp.webhookTitle')}</CardTitle>
        <CardDescription>{t('whatsapp.webhookHint')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={url} readOnly aria-label={t('whatsapp.webhookUrl')} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
          <Button variant="outline" onClick={() => void copy()} className="shrink-0">
            <Copy className="h-4 w-4" /> {t('whatsapp.copy')}
          </Button>
        </div>
        <div>
          <p className="text-xs font-semibold">{t('whatsapp.envTitle')}</p>
          <p className="mt-0.5 text-2xs text-muted-foreground">{t('whatsapp.envHint')}</p>
          <ul className="mt-2 space-y-1.5">
            {ENV_VARS.map((v) => (
              <li key={v} className="flex items-start gap-2 text-xs">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span>
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-2xs">{v}</code>{' '}
                  <span className="text-muted-foreground">{t(`whatsapp.env.${v}`)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-2xs text-muted-foreground">
          {t('whatsapp.inboxHint')}{' '}
          <Link to="/whatsapp" className="font-medium text-primary underline-offset-4 hover:underline">
            {t('whatsapp.openInbox')}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
