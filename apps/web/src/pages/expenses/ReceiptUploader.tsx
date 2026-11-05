import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Paperclip, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MAX_FILE_BYTES, RECEIPT_ACCEPT, attachmentUrl, errorMessage, type AttachmentRef } from './types';

/**
 * Receipt photos / PDFs of a saved expense: lists what is attached (opens in a new tab)
 * and uploads more via POST /attachments (multipart, linked with expenseId).
 */
export function ReceiptUploader({ expenseId, existing }: { expenseId: number; existing: AttachmentRef[] }) {
  const { t } = useTranslation('expenses');
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<AttachmentRef[]>([]);

  const upload = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('expenseId', String(expenseId));
      return api.post<{ attachment: { id: number; fileName: string } }>('/attachments', fd);
    },
    onSuccess: (res) => {
      toast.success(t('receipt.uploaded'));
      setUploaded((list) => [...list, { id: res.attachment.id, fileName: res.attachment.fileName }]);
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: (err) => toast.error(t('receipt.failed', { message: errorMessage(err, t('common:common.errorTitle')) })),
  });

  const all = [...existing, ...uploaded.filter((u) => !existing.some((e) => e.id === u.id))];

  return (
    <div className="space-y-2">
      {all.length > 0 ? (
        <ul className="space-y-1">
          {all.map((a) => (
            <li key={a.id}>
              <a
                href={attachmentUrl(a.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex max-w-full items-center gap-1.5 rounded text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate">{a.fileName}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{t('receipt.none')}</p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          ref={fileInput}
          type="file"
          accept={RECEIPT_ACCEPT}
          aria-label={t('receipt.choose')}
          className="h-auto py-1 text-xs"
          disabled={upload.isPending}
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            if (f && f.size > MAX_FILE_BYTES) {
              setFile(null);
              setFileError(t('receipt.tooLarge'));
              e.target.value = '';
              return;
            }
            setFileError(null);
            setFile(f);
          }}
        />
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={!file || upload.isPending}
          onClick={() => file && upload.mutate(file)}
        >
          <Upload className="h-3.5 w-3.5" /> {upload.isPending ? t('receipt.uploading') : t('receipt.upload')}
        </Button>
      </div>
      {fileError ? (
        <p className="text-2xs font-medium text-destructive" role="alert">
          {fileError}
        </p>
      ) : (
        <p className="text-2xs text-muted-foreground">{t('receipt.hint')}</p>
      )}
    </div>
  );
}
