import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { errorMessage, periodLabel, type RentalDetail } from './types';

/** POST /rentals/:id/generate-next — toasts the new period; 409 PERIOD_EXISTS is informational. */
export function useGenerateNext() {
  const { t } = useTranslation('rentals');
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<{ rental: RentalDetail }>(`/rentals/${id}/generate-next`),
    onSuccess: (res) => {
      toast.success(t('toasts.nextGenerated', { period: periodLabel(res.rental), unit: res.rental.unit.code }));
      void queryClient.invalidateQueries({ queryKey: ['rentals'] });
      void queryClient.invalidateQueries({ queryKey: ['units'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'PERIOD_EXISTS') {
        toast.info(t('toasts.periodExists'));
        return;
      }
      toast.error(errorMessage(err, t('common:common.errorTitle')));
    },
  });
}
