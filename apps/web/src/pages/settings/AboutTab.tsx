import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, EmptyState, ErrorState, LoadingState } from '@/components/ui/misc';
import { SectionTitle, useSettings } from './shared';

export default function AboutTab() {
  const { t, i18n } = useTranslation('settings');
  const { user } = useAuth();
  const settings = useSettings();
  const notice = useQuery({
    queryKey: ['gdpr', 'privacy-notice'],
    queryFn: () => api.get<{ textEn: string; textFi: string }>('/gdpr/privacy-notice'),
    staleTime: 5 * 60_000,
  });

  const company = settings.data?.settings.company;
  const noticeText = notice.data ? (i18n.language === 'fi' ? notice.data.textFi : notice.data.textEn) : '';

  return (
    <div className="space-y-4">
      <SectionTitle title={t('about.title')} description={t('about.description')} />

      <Card>
        <CardHeader>
          <CardTitle>{t('about.systemTitle')}</CardTitle>
          <CardDescription>{t('common:footer.tagline')}</CardDescription>
        </CardHeader>
        <CardContent>
          {settings.isLoading ? (
            <LoadingState />
          ) : settings.isError ? (
            <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
          ) : (
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">{t('about.company')}</dt>
                <dd className="font-medium">{company?.name || '–'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('about.formerName')}</dt>
                <dd className="font-medium">{company?.oldName || '–'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('about.businessId')}</dt>
                <dd className="font-medium">
                  {company?.businessId || <Badge variant="warning">{t('about.missing')}</Badge>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('about.iban')}</dt>
                <dd className="font-medium">{company?.iban || <Badge variant="warning">{t('about.missing')}</Badge>}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('about.signedInAs')}</dt>
                <dd className="font-medium">
                  {user ? `${user.name} · ${t(`common:role.${user.role}`)}` : '–'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('about.languages')}</dt>
                <dd className="font-medium">{t('about.languagesValue')}</dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('about.principlesTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>{t('about.principle1')}</li>
            <li>{t('about.principle2')}</li>
            <li>{t('about.principle3')}</li>
            <li>{t('about.principle4')}</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('about.privacyTitle')}</CardTitle>
          <CardDescription>{t('about.privacyHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          {notice.isLoading ? (
            <LoadingState />
          ) : notice.isError ? (
            <ErrorState error={notice.error} onRetry={() => void notice.refetch()} />
          ) : noticeText.trim() === '' ? (
            <EmptyState title={t('about.noNotice')} />
          ) : (
            <div className="max-h-80 overflow-y-auto whitespace-pre-line rounded-md border bg-muted/30 p-3 text-sm">
              {noticeText}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
