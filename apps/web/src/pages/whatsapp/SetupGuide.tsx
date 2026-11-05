import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Copy, MessageSquareText, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EXAMPLE_MESSAGES } from './types';

const COMPLIANCE_DOC = 'docs/WHATSAPP_META_COMPLIANCE.md';

function webhookUrl(): string {
  return `${window.location.origin}/api/whatsapp/webhook`;
}

/** Shown while the inbox is empty: what has to be done before real messages arrive. */
export function SetupChecklist({ onSimulate }: { onSimulate: () => void }) {
  const { t } = useTranslation('whatsapp');
  const url = webhookUrl();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('setup.copied'));
    } catch {
      toast.error(t('setup.copyFailed'));
    }
  };

  return (
    <section
      aria-labelledby="wa-setup-title"
      className="rounded-lg border border-sky-500/40 bg-sky-500/5 p-4 text-sm"
    >
      <h2 id="wa-setup-title" className="flex items-center gap-2 text-sm font-semibold">
        <Settings2 className="h-4 w-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
        {t('setup.title')}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {t('setup.intro')} <code className="rounded bg-muted px-1 py-0.5 font-mono text-2xs">{COMPLIANCE_DOC}</code>
      </p>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs">
        <li>{t('setup.stepAccount')}</li>
        <li>
          <span>{t('setup.stepWebhook')}</span>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <code className="break-all rounded-md border bg-card px-2 py-1 font-mono text-2xs" aria-label={t('setup.webhookLabel')}>
              {url}
            </code>
            <Button variant="outline" size="sm" onClick={() => void copy()}>
              <Copy className="h-3.5 w-3.5" aria-hidden="true" /> {t('setup.copy')}
            </Button>
          </div>
        </li>
        <li>{t('setup.stepEnv')}</li>
        <li>
          {t('setup.stepAllowList')}{' '}
          <Link to="/settings" className="font-medium text-primary underline-offset-2 hover:underline">
            {t('setup.settingsLink')}
          </Link>
        </li>
        <li>
          <span>{t('setup.stepTest')}</span>{' '}
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onSimulate}>
            {t('actions.simulate')}
          </Button>
        </li>
      </ol>
    </section>
  );
}

/** Message format help — the same lines as the parser's HELP reply. */
export function FormatHelpCard() {
  const { t } = useTranslation('whatsapp');
  const formats = ['rent', 'repair', 'part', 'sale', 'exp'] as const;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquareText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {t('help.title')}
        </CardTitle>
        <CardDescription>{t('help.intro')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs leading-relaxed">
          {formats.map((f) => t(`help.formats.${f}`)).join('\n')}
        </pre>
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          <li>{t('help.payment')}</li>
          <li>{t('help.people')}</li>
          <li>{t('help.discount')}</li>
          <li>{t('help.notes')}</li>
          <li>{t('help.undo')}</li>
          <li>{t('help.sendHelp')}</li>
        </ul>
        <div>
          <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{t('help.examples')}</p>
          <pre className="overflow-x-auto rounded-md border bg-card px-3 py-2 font-mono text-xs leading-relaxed">
            {EXAMPLE_MESSAGES.filter((ex) => ex.includes('|')).join('\n')}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}
