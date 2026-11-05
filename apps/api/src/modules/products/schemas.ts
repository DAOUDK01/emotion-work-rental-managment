import { z } from 'zod';

/**
 * Zod schemas for the /products module (catalogue, barcodes, labels, suppliers).
 * Amounts are integer cents; VAT rates are basis points (2550 = 25.5 %).
 */

export const idParam = z.object({ id: z.coerce.number().int().positive() });

export const barcodeParams = z.object({
  id: z.coerce.number().int().positive(),
  barcodeId: z.coerce.number().int().positive(),
});

export const codeParam = z.object({ code: z.string().trim().min(1).max(64) });

const boolQuery = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

export const ProductListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().trim().max(200).optional(),
  category: z.string().trim().max(100).optional(),
  active: boolQuery,
  lowStock: boolQuery,
});

export const BarcodeInput = z.object({
  barcode: z.string().trim().min(1).max(64),
  type: z.enum(['EAN13', 'CODE128', 'OTHER']).optional(),
});
export type BarcodeInputValue = z.infer<typeof BarcodeInput>;

export const CreateProductSchema = z.object({
  sku: z.string().trim().min(1).max(40).optional(),
  nameEn: z.string().trim().min(1).max(200),
  nameFi: z.string().trim().max(200).nullish(),
  category: z.string().trim().max(100).nullish(),
  brand: z.string().trim().max(100).nullish(),
  compatibleUnits: z.string().trim().max(500).nullish(),
  costCents: z.number().int().min(0).nullish(),
  priceCents: z.number().int().min(0),
  wholesaleCents: z.number().int().min(0).nullish(),
  vatRateBp: z.number().int().min(0).max(10000).optional(),
  trackStock: z.boolean().default(true),
  reorderLevel: z.number().int().min(0).default(0),
  location: z.string().trim().max(100).nullish(),
  supplierId: z.number().int().positive().nullish(),
  barcodes: z.array(BarcodeInput).max(20).optional(),
  initialStock: z.number().int().min(0).optional(),
  active: z.boolean().default(true),
});
export type CreateProductInput = z.infer<typeof CreateProductSchema>;

/** Update: same fields; opening stock exists only at creation (use /stock afterwards). */
export const UpdateProductSchema = CreateProductSchema.omit({ initialStock: true }).partial();
export type UpdateProductInput = z.infer<typeof UpdateProductSchema>;

export const LabelQuery = z.object({
  qty: z.coerce.number().int().min(1).max(120).default(1),
});

export const SupplierListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().trim().max(200).optional(),
  active: boolQuery,
});

export const CreateSupplierSchema = z.object({
  name: z.string().trim().min(1).max(120),
  contact: z.string().trim().max(200).nullish(),
  email: z.string().trim().email().max(200).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  active: z.boolean().default(true),
});
export type CreateSupplierInput = z.infer<typeof CreateSupplierSchema>;

export const UpdateSupplierSchema = CreateSupplierSchema.partial();
export type UpdateSupplierInput = z.infer<typeof UpdateSupplierSchema>;
