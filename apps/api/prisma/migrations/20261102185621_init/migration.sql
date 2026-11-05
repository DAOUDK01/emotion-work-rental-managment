-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'STAFF', 'ACCOUNTANT');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('EN', 'FI');

-- CreateEnum
CREATE TYPE "HolderKind" AS ENUM ('PARTNER', 'COMPANY', 'CASHBOX', 'OTHER');

-- CreateEnum
CREATE TYPE "UnitCategory" AS ENUM ('E_SCOOTER', 'E_BIKE', 'MOPED');

-- CreateEnum
CREATE TYPE "UnitStatus" AS ENUM ('AVAILABLE', 'ON_RENT', 'WAITING_PARTS', 'IN_REPAIR', 'SOLD', 'DISPOSED');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('INDIVIDUAL', 'BUSINESS');

-- CreateEnum
CREATE TYPE "BarcodeType" AS ENUM ('EAN13', 'CODE128', 'OTHER');

-- CreateEnum
CREATE TYPE "StockMoveType" AS ENUM ('PURCHASE', 'SALE', 'RETURN', 'ADJUSTMENT', 'REPAIR_USE', 'TRANSFER', 'IMPORT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PAID', 'INVOICED', 'PENDING', 'NOT_YET_BILLED');

-- CreateEnum
CREATE TYPE "EntrySource" AS ENUM ('POS', 'WEB', 'WHATSAPP', 'IMPORT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('ACTIVE', 'VOID');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('PARKED', 'COMPLETED', 'REFUNDED', 'VOID');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvestmentCategory" AS ENUM ('UNITS', 'SPARE_PARTS', 'TOOLS', 'EXPENSES', 'CASH_INJECTED');

-- CreateEnum
CREATE TYPE "WaStatus" AS ENUM ('RECEIVED', 'SAVED', 'REJECTED', 'ERROR', 'UNDONE');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('OPEN', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('OK', 'ERROR', 'RUNNING');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('PENDING', 'SENT', 'ERROR');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'STAFF',
    "language" "Language" NOT NULL DEFAULT 'EN',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "maxDiscountPct" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "vat_rates" (
    "id" SERIAL NOT NULL,
    "rateBp" INTEGER NOT NULL,
    "validFrom" DATE NOT NULL,
    "label" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "vat_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" SERIAL NOT NULL,
    "rateBp" INTEGER NOT NULL,
    "validFrom" DATE NOT NULL,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salaries" (
    "id" SERIAL NOT NULL,
    "holderId" INTEGER NOT NULL,
    "monthlyCents" INTEGER NOT NULL,
    "validFrom" DATE NOT NULL,
    "note" TEXT,

    CONSTRAINT "salaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "models" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameFi" TEXT NOT NULL,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "money_holders" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "HolderKind" NOT NULL DEFAULT 'OTHER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "money_holders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "nameFi" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "defaultVatInvoice" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" SERIAL NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameFi" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_prefixes" (
    "id" SERIAL NOT NULL,
    "prefix" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "unit_prefixes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "modelName" TEXT,
    "category" "UnitCategory" NOT NULL,
    "inclusions" TEXT,
    "purchaseDate" DATE,
    "sellerName" TEXT,
    "purchaseCents" INTEGER,
    "ownerId" INTEGER,
    "paidById" INTEGER,
    "status" "UnitStatus" NOT NULL DEFAULT 'AVAILABLE',
    "notes" TEXT,
    "legacyName" TEXT,
    "soldCents" INTEGER,
    "soldDate" DATE,
    "soldToCustomerId" INTEGER,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewReason" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "importBatchId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" SERIAL NOT NULL,
    "type" "CustomerType" NOT NULL DEFAULT 'INDIVIDUAL',
    "name" TEXT NOT NULL,
    "businessId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "country" TEXT NOT NULL DEFAULT 'FI',
    "language" "Language" NOT NULL DEFAULT 'EN',
    "notes" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" SERIAL NOT NULL,
    "sku" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameFi" TEXT,
    "category" TEXT,
    "brand" TEXT,
    "compatibleUnits" TEXT,
    "costCents" INTEGER,
    "priceCents" INTEGER NOT NULL,
    "wholesaleCents" INTEGER,
    "vatRateBp" INTEGER NOT NULL DEFAULT 2550,
    "trackStock" BOOLEAN NOT NULL DEFAULT true,
    "reorderLevel" INTEGER NOT NULL DEFAULT 0,
    "location" TEXT,
    "supplierId" INTEGER,
    "imageId" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_barcodes" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "barcode" TEXT NOT NULL,
    "type" "BarcodeType" NOT NULL DEFAULT 'OTHER',

    CONSTRAINT "product_barcodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "type" "StockMoveType" NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitCostCents" INTEGER,
    "shippingCents" INTEGER,
    "customsCents" INTEGER,
    "importVatCents" INTEGER,
    "reason" TEXT,
    "supplierId" INTEGER,
    "unitId" INTEGER,
    "saleLineId" INTEGER,
    "expenseId" INTEGER,
    "creditNoteId" INTEGER,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entries" (
    "id" SERIAL NOT NULL,
    "entryDate" DATE NOT NULL,
    "modelId" INTEGER NOT NULL,
    "unitId" INTEGER,
    "customerId" INTEGER,
    "customerName" TEXT,
    "description" TEXT,
    "grossCents" INTEGER NOT NULL,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "discountReason" TEXT,
    "vatInvoice" BOOLEAN NOT NULL DEFAULT false,
    "vatRateBp" INTEGER NOT NULL DEFAULT 2550,
    "vatCents" INTEGER NOT NULL DEFAULT 0,
    "netCents" INTEGER NOT NULL,
    "labourCents" INTEGER,
    "partsCents" INTEGER,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PAID',
    "paymentMethodId" INTEGER,
    "receivedById" INTEGER,
    "segment" "CustomerType" NOT NULL DEFAULT 'INDIVIDUAL',
    "source" "EntrySource" NOT NULL DEFAULT 'WEB',
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "voidReason" TEXT,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewReason" TEXT,
    "saleId" INTEGER,
    "rentalId" INTEGER,
    "invoiceId" INTEGER,
    "whatsappMessageId" INTEGER,
    "importBatchId" INTEGER,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "methodId" INTEGER,
    "receivedById" INTEGER NOT NULL,
    "entryId" INTEGER,
    "invoiceId" INTEGER,
    "saleId" INTEGER,
    "changeCents" INTEGER,
    "reference" TEXT,
    "note" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "modelId" INTEGER NOT NULL,
    "customerId" INTEGER,
    "unitId" INTEGER,
    "status" "SaleStatus" NOT NULL DEFAULT 'PARKED',
    "cartDiscountCents" INTEGER NOT NULL DEFAULT 0,
    "cartDiscountReason" TEXT,
    "totalGrossCents" INTEGER NOT NULL DEFAULT 0,
    "totalVatCents" INTEGER NOT NULL DEFAULT 0,
    "totalNetCents" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "refundOfId" INTEGER,
    "completedAt" TIMESTAMP(3),
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_lines" (
    "id" SERIAL NOT NULL,
    "saleId" INTEGER NOT NULL,
    "productId" INTEGER,
    "description" TEXT NOT NULL,
    "qty" DECIMAL(10,2) NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "discountReason" TEXT,
    "vatRateBp" INTEGER NOT NULL,
    "lineGrossCents" INTEGER NOT NULL,
    "lineVatCents" INTEGER NOT NULL,
    "lineNetCents" INTEGER NOT NULL,
    "isLabour" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "sale_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" SERIAL NOT NULL,
    "number" INTEGER NOT NULL,
    "numberFormatted" TEXT NOT NULL,
    "customerId" INTEGER NOT NULL,
    "modelId" INTEGER,
    "unitId" INTEGER,
    "rentalId" INTEGER,
    "language" "Language" NOT NULL DEFAULT 'EN',
    "issueDate" DATE NOT NULL,
    "deliveryDate" DATE,
    "periodText" TEXT,
    "dueDate" DATE NOT NULL,
    "termsDays" INTEGER NOT NULL DEFAULT 14,
    "referenceNumber" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "totalGrossCents" INTEGER NOT NULL DEFAULT 0,
    "totalVatCents" INTEGER NOT NULL DEFAULT 0,
    "totalNetCents" INTEGER NOT NULL DEFAULT 0,
    "paidCents" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "sentAt" TIMESTAMP(3),
    "emailedTo" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" SERIAL NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "productId" INTEGER,
    "description" TEXT NOT NULL,
    "qty" DECIMAL(10,2) NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "discountReason" TEXT,
    "vatRateBp" INTEGER NOT NULL,
    "lineGrossCents" INTEGER NOT NULL,
    "lineVatCents" INTEGER NOT NULL,
    "lineNetCents" INTEGER NOT NULL,
    "isLabour" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_notes" (
    "id" SERIAL NOT NULL,
    "number" INTEGER NOT NULL,
    "numberFormatted" TEXT NOT NULL,
    "invoiceId" INTEGER,
    "saleId" INTEGER,
    "issueDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "totalGrossCents" INTEGER NOT NULL,
    "totalVatCents" INTEGER NOT NULL,
    "totalNetCents" INTEGER NOT NULL,
    "restocked" BOOLEAN NOT NULL DEFAULT false,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_note_lines" (
    "id" SERIAL NOT NULL,
    "creditNoteId" INTEGER NOT NULL,
    "productId" INTEGER,
    "description" TEXT NOT NULL,
    "qty" DECIMAL(10,2) NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "vatRateBp" INTEGER NOT NULL,
    "lineGrossCents" INTEGER NOT NULL,
    "lineVatCents" INTEGER NOT NULL,
    "lineNetCents" INTEGER NOT NULL,

    CONSTRAINT "credit_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rentals" (
    "id" SERIAL NOT NULL,
    "unitId" INTEGER NOT NULL,
    "customerId" INTEGER,
    "customerName" TEXT,
    "handOverDate" DATE,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "periodText" TEXT,
    "amountCents" INTEGER NOT NULL,
    "depositCents" INTEGER NOT NULL DEFAULT 0,
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "parentId" INTEGER,
    "agreementSigned" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewReason" TEXT,
    "source" "EntrySource" NOT NULL DEFAULT 'WEB',
    "importBatchId" INTEGER,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rentals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" SERIAL NOT NULL,
    "expenseDate" DATE,
    "categoryId" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "vendor" TEXT,
    "qtyText" TEXT,
    "grossCents" INTEGER,
    "vatRateBp" INTEGER NOT NULL DEFAULT 2550,
    "hasValidReceipt" BOOLEAN NOT NULL DEFAULT false,
    "businessUsePct" INTEGER NOT NULL DEFAULT 100,
    "reclaimableVatCents" INTEGER NOT NULL DEFAULT 0,
    "paidById" INTEGER,
    "jointReinvested" BOOLEAN NOT NULL DEFAULT false,
    "unitId" INTEGER,
    "productId" INTEGER,
    "purchasedFor" TEXT,
    "notes" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "voidReason" TEXT,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewReason" TEXT,
    "source" "EntrySource" NOT NULL DEFAULT 'WEB',
    "importBatchId" INTEGER,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investments" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "holderId" INTEGER,
    "isJoint" BOOLEAN NOT NULL DEFAULT false,
    "category" "InvestmentCategory" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "expenseId" INTEGER,
    "unitId" INTEGER,
    "note" TEXT,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "source" "EntrySource" NOT NULL DEFAULT 'WEB',
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_handovers" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "fromHolderId" INTEGER NOT NULL,
    "toHolderId" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "note" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_handovers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discounts" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT,
    "modelId" INTEGER,
    "entryId" INTEGER,
    "saleId" INTEGER,
    "invoiceId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_messages" (
    "id" SERIAL NOT NULL,
    "waMessageId" TEXT NOT NULL,
    "senderPhone" TEXT NOT NULL,
    "senderName" TEXT,
    "rawText" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "WaStatus" NOT NULL DEFAULT 'RECEIVED',
    "parsed" JSONB,
    "errorText" TEXT,
    "replyText" TEXT,
    "repliedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "undoneAt" TIMESTAMP(3),
    "expenseId" INTEGER,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warranty_claims" (
    "id" SERIAL NOT NULL,
    "caseNumber" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "customerId" INTEGER,
    "unitId" INTEGER,
    "productId" INTEGER,
    "description" TEXT NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'OPEN',
    "claimedCents" INTEGER,
    "approvedCents" INTEGER,
    "submittedAt" DATE,
    "decidedAt" DATE,
    "notes" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warranty_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "terms" TEXT,
    "ratesJson" JSONB,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_jobs" (
    "id" SERIAL NOT NULL,
    "contractId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "vehicleRef" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "hours" DECIMAL(6,2),
    "amountCents" INTEGER NOT NULL,
    "invoiceId" INTEGER,
    "invoicedAt" TIMESTAMP(3),
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" SERIAL NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "sha256" TEXT,
    "uploadedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unitId" INTEGER,
    "expenseId" INTEGER,
    "rentalId" INTEGER,
    "invoiceId" INTEGER,
    "claimId" INTEGER,
    "productId" INTEGER,
    "customerId" INTEGER,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_log" (
    "id" SERIAL NOT NULL,
    "target" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "SyncStatus" NOT NULL DEFAULT 'RUNNING',
    "rowsSynced" INTEGER,
    "error" TEXT,

    CONSTRAINT "sync_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_outbox" (
    "id" SERIAL NOT NULL,
    "toAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "attachmentId" INTEGER,
    "status" "EmailStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" SERIAL NOT NULL,
    "fileName" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    "summary" JSONB NOT NULL,
    "issues" JSONB NOT NULL,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_sequences" (
    "key" TEXT NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "vat_rates_rateBp_validFrom_key" ON "vat_rates"("rateBp", "validFrom");

-- CreateIndex
CREATE INDEX "salaries_holderId_idx" ON "salaries"("holderId");

-- CreateIndex
CREATE UNIQUE INDEX "models_code_key" ON "models"("code");

-- CreateIndex
CREATE UNIQUE INDEX "money_holders_name_key" ON "money_holders"("name");

-- CreateIndex
CREATE UNIQUE INDEX "payment_methods_name_key" ON "payment_methods"("name");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_nameEn_key" ON "expense_categories"("nameEn");

-- CreateIndex
CREATE UNIQUE INDEX "unit_prefixes_prefix_key" ON "unit_prefixes"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "units_code_key" ON "units"("code");

-- CreateIndex
CREATE INDEX "units_status_idx" ON "units"("status");

-- CreateIndex
CREATE INDEX "customers_name_idx" ON "customers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_name_key" ON "suppliers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE INDEX "products_nameEn_idx" ON "products"("nameEn");

-- CreateIndex
CREATE UNIQUE INDEX "product_barcodes_barcode_key" ON "product_barcodes"("barcode");

-- CreateIndex
CREATE INDEX "product_barcodes_productId_idx" ON "product_barcodes"("productId");

-- CreateIndex
CREATE INDEX "stock_movements_productId_createdAt_idx" ON "stock_movements"("productId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "entries_saleId_key" ON "entries"("saleId");

-- CreateIndex
CREATE UNIQUE INDEX "entries_rentalId_key" ON "entries"("rentalId");

-- CreateIndex
CREATE UNIQUE INDEX "entries_invoiceId_key" ON "entries"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "entries_whatsappMessageId_key" ON "entries"("whatsappMessageId");

-- CreateIndex
CREATE INDEX "entries_entryDate_idx" ON "entries"("entryDate");

-- CreateIndex
CREATE INDEX "entries_modelId_entryDate_idx" ON "entries"("modelId", "entryDate");

-- CreateIndex
CREATE INDEX "entries_unitId_idx" ON "entries"("unitId");

-- CreateIndex
CREATE INDEX "entries_paymentStatus_idx" ON "entries"("paymentStatus");

-- CreateIndex
CREATE INDEX "payments_date_idx" ON "payments"("date");

-- CreateIndex
CREATE INDEX "payments_receivedById_date_idx" ON "payments"("receivedById", "date");

-- CreateIndex
CREATE UNIQUE INDEX "sales_number_key" ON "sales"("number");

-- CreateIndex
CREATE INDEX "sales_businessDate_idx" ON "sales"("businessDate");

-- CreateIndex
CREATE INDEX "sale_lines_saleId_idx" ON "sale_lines"("saleId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_numberFormatted_key" ON "invoices"("numberFormatted");

-- CreateIndex
CREATE INDEX "invoices_status_dueDate_idx" ON "invoices"("status", "dueDate");

-- CreateIndex
CREATE INDEX "invoice_lines_invoiceId_idx" ON "invoice_lines"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_number_key" ON "credit_notes"("number");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_numberFormatted_key" ON "credit_notes"("numberFormatted");

-- CreateIndex
CREATE INDEX "rentals_unitId_startDate_idx" ON "rentals"("unitId", "startDate");

-- CreateIndex
CREATE INDEX "expenses_expenseDate_idx" ON "expenses"("expenseDate");

-- CreateIndex
CREATE INDEX "expenses_categoryId_idx" ON "expenses"("categoryId");

-- CreateIndex
CREATE INDEX "investments_date_idx" ON "investments"("date");

-- CreateIndex
CREATE INDEX "cash_handovers_date_idx" ON "cash_handovers"("date");

-- CreateIndex
CREATE INDEX "discounts_date_idx" ON "discounts"("date");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_messages_waMessageId_key" ON "whatsapp_messages"("waMessageId");

-- CreateIndex
CREATE INDEX "whatsapp_messages_senderPhone_receivedAt_idx" ON "whatsapp_messages"("senderPhone", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "warranty_claims_caseNumber_key" ON "warranty_claims"("caseNumber");

-- CreateIndex
CREATE INDEX "contract_jobs_contractId_date_idx" ON "contract_jobs"("contractId", "date");

-- CreateIndex
CREATE INDEX "audit_log_entity_entityId_idx" ON "audit_log"("entity", "entityId");

-- CreateIndex
CREATE INDEX "audit_log_at_idx" ON "audit_log"("at");

-- CreateIndex
CREATE INDEX "sync_log_target_startedAt_idx" ON "sync_log"("target", "startedAt");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salaries" ADD CONSTRAINT "salaries_holderId_fkey" FOREIGN KEY ("holderId") REFERENCES "money_holders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "money_holders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "money_holders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_soldToCustomerId_fkey" FOREIGN KEY ("soldToCustomerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_saleLineId_fkey" FOREIGN KEY ("saleLineId") REFERENCES "sale_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "credit_notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entries" ADD CONSTRAINT "entries_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entries" ADD CONSTRAINT "entries_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entries" ADD CONSTRAINT "entries_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entries" ADD CONSTRAINT "entries_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entries" ADD CONSTRAINT "entries_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "money_holders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entries" ADD CONSTRAINT "entries_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entries" ADD CONSTRAINT "entries_rentalId_fkey" FOREIGN KEY ("rentalId") REFERENCES "rentals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entries" ADD CONSTRAINT "entries_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entries" ADD CONSTRAINT "entries_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entries" ADD CONSTRAINT "entries_whatsappMessageId_fkey" FOREIGN KEY ("whatsappMessageId") REFERENCES "whatsapp_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "money_holders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_refundOfId_fkey" FOREIGN KEY ("refundOfId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_rentalId_fkey" FOREIGN KEY ("rentalId") REFERENCES "rentals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "credit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "rentals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "money_holders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investments" ADD CONSTRAINT "investments_holderId_fkey" FOREIGN KEY ("holderId") REFERENCES "money_holders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investments" ADD CONSTRAINT "investments_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investments" ADD CONSTRAINT "investments_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_fromHolderId_fkey" FOREIGN KEY ("fromHolderId") REFERENCES "money_holders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_toHolderId_fkey" FOREIGN KEY ("toHolderId") REFERENCES "money_holders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_jobs" ADD CONSTRAINT "contract_jobs_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_rentalId_fkey" FOREIGN KEY ("rentalId") REFERENCES "rentals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "warranty_claims"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
