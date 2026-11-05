import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Badge, EmptyState, ErrorState, LoadingState, Segmented } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import {
  SectionTitle,
  SystemLock,
  type VocabCategory,
  type VocabHolder,
  type VocabMethod,
  type VocabModel,
  type VocabPath,
  type VocabPrefix,
  useVocab,
  useVocabSave,
} from './shared';
import { CategoryDialog, HolderDialog, MethodDialog, ModelDialog, PrefixDialog } from './ListDialogs';

type ListKey = 'models' | 'holders' | 'methods' | 'categories' | 'prefixes';

export default function ListsTab() {
  const { t } = useTranslation('settings');
  const [list, setList] = useState<ListKey>('models');
  return (
    <div className="space-y-4">
      <SectionTitle title={t('lists.title')} description={t('lists.description')} />
      <div className="overflow-x-auto">
        <Segmented
          size="sm"
          value={list}
          onChange={setList}
          options={[
            { value: 'models' as const, label: t('lists.models') },
            { value: 'holders' as const, label: t('lists.holders') },
            { value: 'methods' as const, label: t('lists.methods') },
            { value: 'categories' as const, label: t('lists.categories') },
            { value: 'prefixes' as const, label: t('lists.prefixes') },
          ]}
        />
      </div>
      {list === 'models' ? <ModelsList /> : null}
      {list === 'holders' ? <HoldersList /> : null}
      {list === 'methods' ? <MethodsList /> : null}
      {list === 'categories' ? <CategoriesList /> : null}
      {list === 'prefixes' ? <PrefixesList /> : null}
    </div>
  );
}

/* ---------------------- generic list section ---------------------- */

interface Column<T> {
  header: string;
  cell: (row: T) => React.ReactNode;
  className?: string;
}

type Row = { id: number; active: boolean; isSystem?: boolean };

function ListSection<T extends Row>({
  path,
  responseKey,
  title,
  hint,
  addLabel,
  emptyTitle,
  columns,
  rowName,
  renderDialog,
}: {
  path: VocabPath;
  responseKey: string;
  title: string;
  hint: string;
  addLabel: string;
  emptyTitle: string;
  columns: Array<Column<T>>;
  rowName: (row: T) => string;
  renderDialog: (props: { open: boolean; row: T | null; onClose: () => void }) => React.ReactNode;
}) {
  const { t } = useTranslation('settings');
  const q = useVocab<T>(path, responseKey);
  const toggle = useVocabSave(path);
  const [dialog, setDialog] = useState<{ open: boolean; row: T | null }>({ open: false, row: null });
  const [deactivating, setDeactivating] = useState<T | null>(null);

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{hint}</CardDescription>
        </div>
        <Button size="sm" onClick={() => setDialog({ open: true, row: null })}>
          <Plus className="h-3.5 w-3.5" /> {addLabel}
        </Button>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data?.length ? (
          <EmptyState
            title={emptyTitle}
            hint={t('lists.emptyHint')}
            action={
              <Button size="sm" variant="outline" onClick={() => setDialog({ open: true, row: null })}>
                <Plus className="h-3.5 w-3.5" /> {addLabel}
              </Button>
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                {columns.map((c) => (
                  <TH key={c.header} className={c.className}>
                    {c.header}
                  </TH>
                ))}
                <TH>{t('common:common.status')}</TH>
                <TH className="text-right">{t('common:common.actions')}</TH>
              </TR>
            </THead>
            <TBody>
              {q.data.map((row) => (
                <TR key={row.id} className={row.active ? undefined : 'opacity-60'}>
                  {columns.map((c, i) => (
                    <TD key={c.header} className={c.className}>
                      {i === 0 ? (
                        <div className="flex items-center gap-1.5">
                          {c.cell(row)}
                          {row.isSystem ? <SystemLock label={t('lists.systemHint')} /> : null}
                        </div>
                      ) : (
                        c.cell(row)
                      )}
                    </TD>
                  ))}
                  <TD>
                    <Badge variant={row.active ? 'success' : 'default'}>
                      {row.active ? t('lists.active') : t('lists.inactive')}
                    </Badge>
                  </TD>
                  <TD className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('lists.editAria', { name: rowName(row) })}
                        title={t('common:action.edit')}
                        onClick={() => setDialog({ open: true, row })}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={toggle.isPending}
                        onClick={() =>
                          row.active ? setDeactivating(row) : toggle.mutate({ id: row.id, body: { active: true } })
                        }
                      >
                        {row.active ? t('lists.deactivate') : t('lists.activate')}
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {q.data?.some((r) => r.isSystem) ? (
          <p className="mt-2 flex items-center gap-1.5 text-2xs text-muted-foreground">
            <SystemLock label={t('lists.systemHint')} /> {t('lists.systemHint')}
          </p>
        ) : null}
      </CardContent>
      {renderDialog({
        open: dialog.open,
        row: dialog.row,
        onClose: () => setDialog({ open: false, row: null }),
      })}
      <ConfirmDialog
        open={deactivating !== null}
        onClose={() => setDeactivating(null)}
        title={t('lists.deactivateTitle')}
        message={t('lists.deactivateConfirm', { name: deactivating ? rowName(deactivating) : '' })}
        confirmLabel={t('lists.deactivate')}
        busy={toggle.isPending}
        onConfirm={() =>
          deactivating &&
          toggle.mutate({ id: deactivating.id, body: { active: false } }, { onSuccess: () => setDeactivating(null) })
        }
      />
    </Card>
  );
}

/* ----------------------------- lists ----------------------------- */

function ModelsList() {
  const { t } = useTranslation('settings');
  return (
    <ListSection<VocabModel>
      path="models"
      responseKey="models"
      title={t('lists.models')}
      hint={t('lists.modelsHint')}
      addLabel={t('lists.addModel')}
      emptyTitle={t('lists.emptyModels')}
      rowName={(r) => r.nameEn}
      columns={[
        { header: t('lists.code'), cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
        { header: t('lists.nameEn'), cell: (r) => r.nameEn },
        { header: t('lists.nameFi'), cell: (r) => r.nameFi },
        {
          header: t('lists.color'),
          cell: (r) =>
            r.color ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3.5 w-3.5 rounded-sm border" style={{ backgroundColor: r.color }} aria-hidden />
                <span className="font-mono text-2xs">{r.color}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">{t('lists.defaultColor')}</span>
            ),
        },
        { header: t('lists.sortOrder'), cell: (r) => r.sortOrder, className: 'text-right tabular-nums' },
      ]}
      renderDialog={(p) => <ModelDialog {...p} />}
    />
  );
}

function HoldersList() {
  const { t } = useTranslation('settings');
  return (
    <ListSection<VocabHolder>
      path="holders"
      responseKey="holders"
      title={t('lists.holders')}
      hint={t('lists.holdersHint')}
      addLabel={t('lists.addHolder')}
      emptyTitle={t('lists.emptyHolders')}
      rowName={(r) => r.name}
      columns={[
        { header: t('lists.name'), cell: (r) => <span className="font-medium">{r.name}</span> },
        { header: t('lists.kind'), cell: (r) => <Badge variant="outline">{t(`kind.${r.kind}`)}</Badge> },
        { header: t('lists.sortOrder'), cell: (r) => r.sortOrder, className: 'text-right tabular-nums' },
      ]}
      renderDialog={(p) => <HolderDialog {...p} />}
    />
  );
}

function MethodsList() {
  const { t } = useTranslation('settings');
  return (
    <ListSection<VocabMethod>
      path="methods"
      responseKey="methods"
      title={t('lists.methods')}
      hint={t('lists.methodsHint')}
      addLabel={t('lists.addMethod')}
      emptyTitle={t('lists.emptyMethods')}
      rowName={(r) => r.name}
      columns={[
        { header: t('lists.nameEn'), cell: (r) => <span className="font-medium">{r.name}</span> },
        { header: t('lists.nameFi'), cell: (r) => r.nameFi ?? '–' },
        {
          header: t('lists.defaultVatInvoice'),
          cell: (r) =>
            r.defaultVatInvoice ? (
              <Badge variant="info">{t('common:common.yes')}</Badge>
            ) : (
              <Badge>{t('common:common.no')}</Badge>
            ),
        },
        { header: t('lists.sortOrder'), cell: (r) => r.sortOrder, className: 'text-right tabular-nums' },
      ]}
      renderDialog={(p) => <MethodDialog {...p} />}
    />
  );
}

function CategoriesList() {
  const { t } = useTranslation('settings');
  return (
    <ListSection<VocabCategory>
      path="expense-categories"
      responseKey="categories"
      title={t('lists.categories')}
      hint={t('lists.categoriesHint')}
      addLabel={t('lists.addCategory')}
      emptyTitle={t('lists.emptyCategories')}
      rowName={(r) => r.nameEn}
      columns={[
        { header: t('lists.nameEn'), cell: (r) => <span className="font-medium">{r.nameEn}</span> },
        { header: t('lists.nameFi'), cell: (r) => r.nameFi ?? '–' },
        { header: t('lists.sortOrder'), cell: (r) => r.sortOrder, className: 'text-right tabular-nums' },
      ]}
      renderDialog={(p) => <CategoryDialog {...p} />}
    />
  );
}

function PrefixesList() {
  const { t } = useTranslation('settings');
  return (
    <ListSection<VocabPrefix>
      path="unit-prefixes"
      responseKey="prefixes"
      title={t('lists.prefixes')}
      hint={t('lists.prefixesHint')}
      addLabel={t('lists.addPrefix')}
      emptyTitle={t('lists.emptyPrefixes')}
      rowName={(r) => r.prefix}
      columns={[
        { header: t('lists.prefix'), cell: (r) => <span className="font-mono text-xs font-semibold">{r.prefix}</span> },
        { header: t('lists.brandName'), cell: (r) => r.brandName },
      ]}
      renderDialog={(p) => <PrefixDialog {...p} />}
    />
  );
}
