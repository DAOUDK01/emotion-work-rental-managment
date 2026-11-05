import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Eye, EyeOff, Pencil, UserPlus } from 'lucide-react';
import { api } from '@/lib/api';
import { type Role, useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select } from '@/components/ui/input';
import { Badge, EmptyState, ErrorState, LoadingState } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ROLES, SectionTitle, type UserRow } from './shared';

export default function UsersTab() {
  const { t } = useTranslation('settings');
  const { user: me } = useAuth();
  const q = useQuery({ queryKey: ['users'], queryFn: () => api.get<{ users: UserRow[] }>('/users') });
  const [dialog, setDialog] = useState<{ open: boolean; row: UserRow | null }>({ open: false, row: null });

  const roleVariant = (r: Role): 'navy' | 'info' | 'default' =>
    r === 'ADMIN' ? 'navy' : r === 'ACCOUNTANT' ? 'info' : 'default';

  return (
    <div className="space-y-4">
      <SectionTitle title={t('users.title')} description={t('users.description')} />
      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 space-y-0">
          <div>
            <CardTitle>{t('users.listTitle')}</CardTitle>
            <CardDescription>{t('users.listHint')}</CardDescription>
          </div>
          <Button size="sm" onClick={() => setDialog({ open: true, row: null })}>
            <UserPlus className="h-3.5 w-3.5" /> {t('users.add')}
          </Button>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <LoadingState />
          ) : q.isError ? (
            <ErrorState error={q.error} onRetry={() => void q.refetch()} />
          ) : !q.data?.users.length ? (
            <EmptyState title={t('users.empty')} hint={t('users.emptyHint')} />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{t('users.name')}</TH>
                  <TH>{t('users.email')}</TH>
                  <TH>{t('users.role')}</TH>
                  <TH>{t('users.language')}</TH>
                  <TH className="text-right">{t('users.maxDiscount')}</TH>
                  <TH>{t('common:common.status')}</TH>
                  <TH>{t('users.created')}</TH>
                  <TH className="text-right">{t('common:common.actions')}</TH>
                </TR>
              </THead>
              <TBody>
                {q.data.users.map((u) => (
                  <TR key={u.id} className={u.active ? undefined : 'opacity-60'}>
                    <TD className="font-medium">
                      {u.name}
                      {u.id === me?.id ? <span className="ml-1.5 text-2xs text-muted-foreground">({t('users.you')})</span> : null}
                    </TD>
                    <TD className="break-all">{u.email}</TD>
                    <TD>
                      <Badge variant={roleVariant(u.role)}>{t(`common:role.${u.role}`)}</Badge>
                    </TD>
                    <TD>{u.language === 'FI' ? t('users.langFi') : t('users.langEn')}</TD>
                    <TD className="text-right tabular-nums">{u.role === 'STAFF' ? `${u.maxDiscountPct} %` : '–'}</TD>
                    <TD>
                      <Badge variant={u.active ? 'success' : 'default'}>
                        {u.active ? t('lists.active') : t('lists.inactive')}
                      </Badge>
                    </TD>
                    <TD className="whitespace-nowrap">{fmtDate(u.createdAt)}</TD>
                    <TD className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('users.editAria', { name: u.name })}
                        title={t('common:action.edit')}
                        onClick={() => setDialog({ open: true, row: u })}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('users.rolesTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-3">
            {ROLES.map((r) => (
              <div key={r} className="rounded-md border p-3">
                <dt className="text-sm font-semibold">{t(`common:role.${r}`)}</dt>
                <dd className="mt-1 text-xs text-muted-foreground">{t(`users.roleHelp.${r}`)}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <UserDialog
        open={dialog.open}
        row={dialog.row}
        selfId={me?.id ?? null}
        onClose={() => setDialog({ open: false, row: null })}
      />
    </div>
  );
}

interface UserForm {
  email: string;
  name: string;
  role: Role;
  language: 'EN' | 'FI';
  maxDiscountPct: string;
  active: boolean;
  password: string;
}

function UserDialog({
  open,
  row,
  selfId,
  onClose,
}: {
  open: boolean;
  row: UserRow | null;
  selfId: number | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const { refresh } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const isNew = row === null;
  const isSelf = row !== null && row.id === selfId;

  const schema = useMemo(
    () =>
      z.object({
        email: z
          .string()
          .trim()
          .refine((v) => !isNew || z.string().email().safeParse(v).success, t('validation.email')),
        name: z.string().trim().min(1, t('validation.required')).max(100),
        role: z.enum(['ADMIN', 'STAFF', 'ACCOUNTANT']),
        language: z.enum(['EN', 'FI']),
        maxDiscountPct: z
          .string()
          .trim()
          .refine((v) => /^\d{1,3}$/.test(v) && Number(v) <= 100, t('users.discountInvalid')),
        active: z.boolean(),
        password: z
          .string()
          .refine((v) => (isNew ? v.length >= 8 : v === '' || v.length >= 8), t('users.passwordMin')),
      }),
    [t, isNew],
  );

  const defaults = useMemo<UserForm>(
    () => ({
      email: row?.email ?? '',
      name: row?.name ?? '',
      role: row?.role ?? 'STAFF',
      language: row?.language ?? 'FI',
      maxDiscountPct: String(row?.maxDiscountPct ?? 10),
      active: row?.active ?? true,
      password: '',
    }),
    [row],
  );

  const {
    register,
    handleSubmit,
    reset,
    watch,
    control,
    formState: { errors },
  } = useForm<UserForm>({ resolver: zodResolver(schema), defaultValues: defaults });

  useEffect(() => {
    if (open) {
      reset(defaults);
      setShowPassword(false);
    }
  }, [open, defaults, reset]);

  const role = watch('role');

  const mutation = useMutation({
    mutationFn: (v: UserForm) => {
      // discount cap only limits STAFF at the POS; other roles keep the full 100 %
      const maxDiscountPct = v.role === 'STAFF' ? Number(v.maxDiscountPct) : 100;
      if (row === null) {
        return api.post<{ user: UserRow }>('/users', {
          email: v.email.trim(),
          name: v.name.trim(),
          password: v.password,
          role: v.role,
          language: v.language,
          maxDiscountPct,
        });
      }
      return api.put<{ user: UserRow }>(`/users/${row.id}`, {
        name: v.name.trim(),
        role: isSelf ? undefined : v.role,
        language: v.language,
        maxDiscountPct,
        active: isSelf ? undefined : v.active,
        password: v.password === '' ? undefined : v.password,
      });
    },
    onSuccess: (_data, v) => {
      toast.success(
        !isNew && v.password !== '' ? t('users.passwordResetOk') : isNew ? t('users.createdOk') : t('common:common.savedOk'),
      );
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      if (isSelf) void refresh();
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onClose={onClose} title={row === null ? t('users.add') : t('users.editTitle', { name: row.name })} wide>
      <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-3" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t('users.email')}
            error={errors.email?.message}
            hint={isNew ? t('users.emailHint') : t('users.emailLocked')}
            required={isNew}
          >
            <Input
              type="email"
              autoComplete="off"
              autoFocus={isNew}
              readOnly={!isNew}
              aria-readonly={!isNew}
              className={isNew ? undefined : 'bg-muted/40'}
              {...register('email')}
            />
          </Field>
          <Field label={t('users.name')} error={errors.name?.message} required>
            <Input autoFocus={!isNew} autoComplete="off" {...register('name')} />
          </Field>
          <Field
            label={t('users.role')}
            error={errors.role?.message}
            hint={t(`users.roleHelp.${role}`)}
            required
          >
            {isSelf ? (
              <Input value={t(`common:role.${role}`)} readOnly aria-readonly="true" className="bg-muted/40" />
            ) : (
              <Select {...register('role')}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`common:role.${r}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('users.language')} error={errors.language?.message} hint={t('users.languageHint')}>
            <Select {...register('language')}>
              <option value="FI">{t('users.langFi')}</option>
              <option value="EN">{t('users.langEn')}</option>
            </Select>
          </Field>
          {role === 'STAFF' ? (
            <Field
              label={t('users.maxDiscount')}
              error={errors.maxDiscountPct?.message}
              hint={t('users.maxDiscountHint')}
              required
            >
              <Input inputMode="numeric" {...register('maxDiscountPct')} />
            </Field>
          ) : null}
          <Field
            label={isNew ? t('users.password') : t('users.resetPassword')}
            error={errors.password?.message}
            hint={isNew ? t('users.passwordHint') : t('users.resetPasswordHint')}
            required={isNew}
          >
            <div className="flex gap-2">
              <Input type={showPassword ? 'text' : 'password'} autoComplete="new-password" {...register('password')} />
              <Button
                variant="outline"
                size="icon"
                className="shrink-0"
                aria-label={showPassword ? t('form.hidePassword') : t('form.showPassword')}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((s) => !s)}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </Field>
        </div>
        {!isNew ? (
          <Controller
            control={control}
            name="active"
            render={({ field }) => (
              <div className="space-y-1">
                <Checkbox
                  label={t('users.activeLabel')}
                  checked={field.value}
                  disabled={isSelf}
                  onChange={(e) => field.onChange(e.target.checked)}
                />
                <p className="text-2xs text-muted-foreground">
                  {isSelf ? t('users.selfGuard') : t('users.activeHint')}
                </p>
              </div>
            )}
          />
        ) : null}
        {isSelf ? <p className="text-2xs text-muted-foreground">{t('users.selfRoleGuard')}</p> : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t('common:action.cancel')}
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {isNew ? t('users.create') : t('common:action.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
