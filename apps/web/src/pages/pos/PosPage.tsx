import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CalendarCheck, Keyboard, ListRestart, Undo2 } from 'lucide-react';
import { api, ApiError, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Badge, ErrorState, PageHeader, Spinner } from '@/components/ui/misc';
import { ProductPane } from './ProductPane';
import { CartPane, type CartActions } from './CartPane';
import { CameraScanDialog, UnknownBarcodeDialog } from './BarcodeDialogs';
import { CustomLineDialog, DiscountDialog, type CustomLineBody, type DiscountBody } from './LineDialogs';
import { SaleDetailsDialog, type SaleDetailsBody } from './SaleDetailsDialog';
import { PaymentDialog } from './PaymentDialog';
import { ParkedDrawer } from './ParkedDrawer';
import { RefundDialog } from './RefundDialog';
import { ZReportDialog } from './ZReportDialog';
import { SuccessScreen } from './SuccessScreen';
import { isEditableElement, useBarcodeWedge } from './useBarcodeWedge';
import {
  errMsg,
  lineAmountCents,
  productName,
  saleExclVat,
  type Lookups,
  type ProductRow,
  type RunOp,
  type Sale,
  type SaleLine,
  type SaleListResponse,
  type SaleResponse,
} from './types';

/**
 * POS — fast sale screen for tablet/desktop.
 * Left: product search + quick grid. Right: the cart (a PARKED sale on the API, created
 * lazily on the first line). Barcodes arrive from a keyboard-wedge scanner (global
 * listener) or the camera dialog. Shortcuts: "/" search, Enter add highlighted, F2 pay.
 */
export default function PosPage() {
  const { t, i18n } = useTranslation('pos');
  const lang = i18n.language;
  const { user } = useAuth();
  const maxDiscountPct = user?.maxDiscountPct ?? 0;
  const queryClient = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');

  // ---- current sale (id in state + refs so queued operations always see the latest)
  const [saleId, setSaleId] = useState<number | null>(null);
  const saleIdRef = useRef<number | null>(null);
  const saleRef = useRef<Sale | undefined>(undefined);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const [pendingOps, setPendingOps] = useState(0);
  const [completed, setCompleted] = useState<{ sale: Sale; changeCents: number } | null>(null);

  // ---- dialogs
  const [cameraOpen, setCameraOpen] = useState(false);
  const [unknownBarcode, setUnknownBarcode] = useState<string | null>(null);
  const [discountLine, setDiscountLine] = useState<SaleLine | null>(null);
  const [cartDiscountOpen, setCartDiscountOpen] = useState(false);
  const [customKind, setCustomKind] = useState<'labour' | 'free' | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [parkedOpen, setParkedOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [zOpen, setZOpen] = useState(false);
  const [lineToRemove, setLineToRemove] = useState<SaleLine | null>(null);
  const [voidOpen, setVoidOpen] = useState(false);

  // ---- data
  const lookups = useQuery({
    queryKey: ['lookups'],
    queryFn: () => api.get<Lookups>('/lookups'),
    staleTime: 5 * 60_000,
  });
  const parked = useQuery({
    queryKey: ['pos', 'sales', 'PARKED'],
    queryFn: () => api.get<SaleListResponse>('/pos/sales' + qs({ status: 'PARKED', pageSize: 100 })),
  });
  const saleQuery = useQuery({
    queryKey: ['pos', 'sale', saleId],
    queryFn: () => api.get<SaleResponse>(`/pos/sales/${saleId}`),
    enabled: saleId !== null,
  });
  const sale = saleId !== null ? saleQuery.data?.sale : undefined;

  useEffect(() => {
    if (sale && sale.id === saleIdRef.current) saleRef.current = sale;
  }, [sale]);

  const defaultModelId = useMemo(() => {
    const models = lookups.data?.models ?? [];
    return models.find((m) => m.code === 'SPARE_PARTS')?.id ?? models[0]?.id ?? null;
  }, [lookups.data]);
  const defaultModelRef = useRef<number | null>(null);
  useEffect(() => {
    defaultModelRef.current = defaultModelId;
  }, [defaultModelId]);

  const selectSale = useCallback(
    (id: number | null) => {
      saleIdRef.current = id;
      saleRef.current = id === null ? undefined : queryClient.getQueryData<SaleResponse>(['pos', 'sale', id])?.sale;
      setSaleId(id);
    },
    [queryClient],
  );

  const applySale = useCallback(
    (s: Sale) => {
      queryClient.setQueryData<SaleResponse>(['pos', 'sale', s.id], { sale: s });
      if (saleIdRef.current === null || saleIdRef.current === s.id) saleRef.current = s;
    },
    [queryClient],
  );

  // A resumed sale that was completed/voided elsewhere can no longer be edited here.
  useEffect(() => {
    if (sale && sale.status !== 'PARKED') {
      toast.info(t('errors.notEditable', { number: sale.number }));
      selectSale(null);
    }
  }, [sale, selectSale, t]);

  /** Creates the PARKED sale lazily (SPARE_PARTS model by default). */
  const ensureSale = useCallback(async (): Promise<number> => {
    if (saleIdRef.current !== null) return saleIdRef.current;
    const modelId = defaultModelRef.current;
    if (!modelId) throw new Error(t('errors.noModel'));
    const res = await api.post<SaleResponse>('/pos/sales', { modelId });
    applySale(res.sale);
    selectSale(res.sale.id);
    void queryClient.invalidateQueries({ queryKey: ['pos', 'sales', 'PARKED'] });
    return res.sale.id;
  }, [applySale, selectSale, queryClient, t]);

  /** Serialises every cart write so fast scans never race (qty+1 always sees the latest cart). */
  const runOp = useCallback<RunOp>(
    (fn) => {
      setPendingOps((n) => n + 1);
      const job = queueRef.current.then(async () => {
        const id = await ensureSale();
        let current = saleRef.current?.id === id ? saleRef.current : undefined;
        if (!current) {
          const fresh = await queryClient.fetchQuery({
            queryKey: ['pos', 'sale', id],
            queryFn: () => api.get<SaleResponse>(`/pos/sales/${id}`),
          });
          current = fresh.sale;
        }
        const res = await fn(id, current);
        applySale(res.sale);
        return res.sale;
      });
      queueRef.current = job.catch(() => undefined);
      void job.then(
        () => setPendingOps((n) => n - 1),
        () => setPendingOps((n) => n - 1),
      );
      return job;
    },
    [ensureSale, applySale, queryClient],
  );

  // ---- cart operations
  const addProduct = useCallback(
    async (product: Pick<ProductRow, 'id' | 'nameEn' | 'nameFi'>) => {
      setCompleted(null);
      try {
        await runOp((id, current) => {
          const existing = current?.lines.find((l) => l.productId === product.id);
          return existing
            ? api.put<SaleResponse>(`/pos/sales/${id}/lines/${existing.id}`, { qty: existing.qty + 1 })
            : api.post<SaleResponse>(`/pos/sales/${id}/lines`, { productId: product.id, qty: 1 });
        });
        toast.success(t('toast.added', { name: productName(product, lang) }), { id: 'pos-add', duration: 1500 });
      } catch (err) {
        toast.error(errMsg(err));
      }
    },
    [runOp, t, lang],
  );

  const handleCode = useCallback(
    async (code: string) => {
      setCameraOpen(false);
      // The scanner may have typed into the search box — take the code back out.
      setSearch((prev) => (prev.endsWith(code) ? prev.slice(0, -code.length) : prev));
      try {
        const { product } = await api.get<{ product: ProductRow }>(`/products/barcode/${encodeURIComponent(code)}`);
        if (!product.active) toast.warning(t('toast.inactiveProduct', { name: productName(product, lang) }));
        await addProduct(product);
      } catch (err) {
        if (err instanceof ApiError && (err.code === 'UNKNOWN_BARCODE' || err.status === 404)) setUnknownBarcode(code);
        else toast.error(errMsg(err));
      }
    },
    [addProduct, t, lang],
  );

  const changeQty = (line: SaleLine, qty: number) => {
    if (qty <= 0) {
      setLineToRemove(line);
      return;
    }
    runOp((id) => api.put<SaleResponse>(`/pos/sales/${id}/lines/${line.id}`, { qty })).catch((err: unknown) =>
      toast.error(errMsg(err)),
    );
  };

  const removeLine = useMutation({
    mutationFn: (line: SaleLine) => runOp((id) => api.del<SaleResponse>(`/pos/sales/${id}/lines/${line.id}`)),
    onSuccess: () => {
      toast.success(t('toast.removed'));
      setLineToRemove(null);
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  const submitLineDiscount = (line: SaleLine) => (body: DiscountBody) =>
    runOp((id) =>
      api.put<SaleResponse>(
        `/pos/sales/${id}/lines/${line.id}`,
        body.cents !== undefined
          ? { discountCents: body.cents, discountReason: body.reason }
          : { discountPct: body.pct, discountReason: body.reason },
      ),
    );

  const submitCartDiscount = (body: DiscountBody) =>
    runOp((id) =>
      api.put<SaleResponse>(
        `/pos/sales/${id}`,
        body.cents !== undefined
          ? { cartDiscountCents: body.cents, cartDiscountReason: body.reason }
          : { cartDiscountPct: body.pct, cartDiscountReason: body.reason },
      ),
    );

  const submitCustomLine = (body: CustomLineBody) => {
    setCompleted(null);
    return runOp((id) => api.post<SaleResponse>(`/pos/sales/${id}/lines`, body));
  };

  const submitDetails = (body: SaleDetailsBody) =>
    runOp((id) => api.put<SaleResponse>(`/pos/sales/${id}`, body)).then((s) => {
      void queryClient.invalidateQueries({ queryKey: ['pos', 'sales', 'PARKED'] });
      return s;
    });

  const park = useMutation({
    mutationFn: async () => {
      await queueRef.current;
      const id = saleIdRef.current;
      if (id === null) throw new Error(t('errors.noSale'));
      return api.post<SaleResponse>(`/pos/sales/${id}/park`);
    },
    onSuccess: (res) => {
      toast.success(t('toast.parked', { number: res.sale.number }));
      selectSale(null);
      queryClient.setQueryData<SaleResponse>(['pos', 'sale', res.sale.id], { sale: res.sale });
      setSearch('');
      void queryClient.invalidateQueries({ queryKey: ['pos', 'sales', 'PARKED'] });
      searchRef.current?.focus();
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  const voidSale = useMutation({
    mutationFn: async () => {
      await queueRef.current;
      const id = saleIdRef.current;
      if (id === null) throw new Error(t('errors.noSale'));
      return api.del<SaleResponse>(`/pos/sales/${id}`);
    },
    onSuccess: (res) => {
      toast.success(t('toast.voided', { number: res.sale.number }));
      selectSale(null);
      setVoidOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['pos', 'sales', 'PARKED'] });
      searchRef.current?.focus();
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  const onCompleted = (done: Sale, changeCents: number) => {
    setPayOpen(false);
    selectSale(null);
    queryClient.setQueryData<SaleResponse>(['pos', 'sale', done.id], { sale: done });
    setSearch('');
    setCompleted({ sale: done, changeCents });
    void queryClient.invalidateQueries({ queryKey: ['pos', 'sales'] });
    void queryClient.invalidateQueries({ queryKey: ['products'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['entries'] });
    void queryClient.invalidateQueries({ queryKey: ['cash'] });
  };

  const resume = (id: number) => {
    setCompleted(null);
    selectSale(id);
    const found = parked.data?.sales.find((s) => s.id === id);
    if (found) toast.success(t('toast.resumed', { number: found.number }));
  };

  // ---- keyboard: wedge scanner + shortcuts
  const anyDialogOpen =
    cameraOpen ||
    unknownBarcode !== null ||
    discountLine !== null ||
    cartDiscountOpen ||
    customKind !== null ||
    detailsOpen ||
    payOpen ||
    parkedOpen ||
    refundOpen ||
    zOpen ||
    lineToRemove !== null ||
    voidOpen;
  const canPay = !!sale && sale.status === 'PARKED' && sale.lines.length > 0 && sale.totalGrossCents > 0;

  useBarcodeWedge((code) => void handleCode(code), !anyDialogOpen);

  useEffect(() => {
    if (anyDialogOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        if (canPay) setPayOpen(true);
        else toast.info(t('errors.nothingToPay'));
        return;
      }
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !isEditableElement(document.activeElement)) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [anyDialogOpen, canPay, t]);

  const resumable = (parked.data?.sales ?? []).filter((s) => s.id !== saleId);
  const parkedCount = parked.data?.sales.length ?? 0;
  const cartBusy = park.isPending || voidSale.isPending;

  const actions: CartActions = {
    onQty: changeQty,
    onRemove: setLineToRemove,
    onLineDiscount: setDiscountLine,
    onLabour: () => setCustomKind('labour'),
    onFreeLine: () => setCustomKind('free'),
    onCartDiscount: () => setCartDiscountOpen(true),
    onDetails: () => setDetailsOpen(true),
    onPark: () => park.mutate(),
    onVoidSale: () => setVoidOpen(true),
    onPay: () => setPayOpen(true),
    onResume: resume,
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <>
            {pendingOps > 0 ? <Spinner className="h-5 w-5" /> : null}
            <Button
              variant="outline"
              onClick={() => {
                void parked.refetch();
                setParkedOpen(true);
              }}
            >
              <ListRestart className="h-4 w-4" /> {t('header.parked')}
              {parkedCount > 0 ? <Badge variant="info">{parkedCount}</Badge> : null}
            </Button>
            <Button variant="outline" onClick={() => setRefundOpen(true)}>
              <Undo2 className="h-4 w-4" /> {t('header.findReceipt')}
            </Button>
            <Button variant="outline" onClick={() => setZOpen(true)}>
              <CalendarCheck className="h-4 w-4" /> {t('header.zReport')}
            </Button>
          </>
        }
      />

      {lookups.isError ? <ErrorState error={lookups.error} onRetry={() => void lookups.refetch()} /> : null}

      {completed ? (
        <SuccessScreen
          sale={completed.sale}
          changeCents={completed.changeCents}
          onNewSale={() => {
            setCompleted(null);
            setTimeout(() => searchRef.current?.focus(), 0);
          }}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,440px)]">
          <ProductPane
            ref={searchRef}
            search={search}
            onSearchChange={setSearch}
            onAdd={(p) => {
              void addProduct(p);
              if (search) setSearch('');
            }}
            onOpenCamera={() => setCameraOpen(true)}
          />
          <CartPane
            sale={sale}
            loading={saleId !== null && saleQuery.isLoading}
            error={saleId !== null && saleQuery.isError ? saleQuery.error : null}
            onRetry={() => void saleQuery.refetch()}
            busy={cartBusy}
            resumable={resumable}
            actions={actions}
          />
        </div>
      )}

      <p className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
        <Keyboard className="h-3.5 w-3.5" aria-hidden="true" /> {t('shortcuts')}
      </p>

      {/* ---- dialogs ---- */}
      <CameraScanDialog open={cameraOpen} onClose={() => setCameraOpen(false)} onCode={(code) => void handleCode(code)} />
      <UnknownBarcodeDialog
        barcode={unknownBarcode}
        lookups={lookups.data}
        onClose={() => setUnknownBarcode(null)}
        onCreated={(product) => {
          setUnknownBarcode(null);
          void addProduct(product);
        }}
      />
      <DiscountDialog
        open={discountLine !== null}
        title={t('discount.lineTitle')}
        description={
          discountLine
            ? discountLine.product
              ? productName(discountLine.product, lang)
              : discountLine.description
            : ''
        }
        baseCents={
          discountLine ? lineAmountCents(discountLine, saleExclVat(sale)) + discountLine.discountCents : 0
        }
        initialCents={discountLine?.discountCents ?? 0}
        initialReason={discountLine?.discountReason ?? null}
        maxDiscountPct={maxDiscountPct}
        onClose={() => setDiscountLine(null)}
        onSubmit={discountLine ? submitLineDiscount(discountLine) : () => Promise.resolve()}
      />
      <DiscountDialog
        open={cartDiscountOpen}
        title={t('discount.cartTitle')}
        description={t('discount.cartDescription', {
          amount: fmtEUR((sale?.lines ?? []).reduce((s, l) => s + lineAmountCents(l, saleExclVat(sale)), 0)),
        })}
        baseCents={(sale?.lines ?? []).reduce((s, l) => s + lineAmountCents(l, saleExclVat(sale)), 0)}
        initialCents={sale?.cartDiscountCents ?? 0}
        initialReason={sale?.cartDiscountReason ?? null}
        maxDiscountPct={maxDiscountPct}
        onClose={() => setCartDiscountOpen(false)}
        onSubmit={submitCartDiscount}
      />
      <CustomLineDialog
        kind={customKind}
        lookups={lookups.data}
        exclVat={saleExclVat(sale)}
        onClose={() => setCustomKind(null)}
        onSubmit={submitCustomLine}
      />
      <SaleDetailsDialog
        open={detailsOpen}
        sale={sale}
        lookups={lookups.data}
        defaultModelId={defaultModelId}
        onClose={() => setDetailsOpen(false)}
        onSubmit={submitDetails}
      />
      <PaymentDialog
        open={payOpen}
        sale={sale}
        lookups={lookups.data}
        onClose={() => setPayOpen(false)}
        onCompleted={onCompleted}
      />
      <ParkedDrawer
        open={parkedOpen}
        onClose={() => setParkedOpen(false)}
        parked={parked}
        currentSaleId={saleId}
        onResume={resume}
        onVoided={(id) => {
          if (id === saleIdRef.current) selectSale(null);
        }}
      />
      <RefundDialog open={refundOpen} lookups={lookups.data} onClose={() => setRefundOpen(false)} />
      <ZReportDialog open={zOpen} onClose={() => setZOpen(false)} />
      <ConfirmDialog
        open={lineToRemove !== null}
        onClose={() => setLineToRemove(null)}
        onConfirm={() => {
          if (lineToRemove) removeLine.mutate(lineToRemove);
        }}
        title={t('cart.removeTitle')}
        message={t('cart.removeMessage', {
          name: lineToRemove
            ? lineToRemove.product
              ? productName(lineToRemove.product, lang)
              : lineToRemove.description
            : '',
        })}
        confirmLabel={t('common:action.delete')}
        busy={removeLine.isPending}
      />
      <ConfirmDialog
        open={voidOpen}
        onClose={() => setVoidOpen(false)}
        onConfirm={() => voidSale.mutate()}
        title={t('cart.voidTitle')}
        message={t('cart.voidMessage', { number: sale?.number ?? '', amount: fmtEUR(sale?.totalGrossCents ?? 0) })}
        confirmLabel={t('common:action.void')}
        busy={voidSale.isPending}
      />
    </div>
  );
}
