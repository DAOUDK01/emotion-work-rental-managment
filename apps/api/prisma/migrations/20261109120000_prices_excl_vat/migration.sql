-- "VAT on top": selling prices are entered WITHOUT VAT from now on.
--
-- 1. Sales remember how they were priced. Existing sales keep their VAT-inclusive
--    maths (false); every new sale is priced without VAT (column default true).
ALTER TABLE "sales" ADD COLUMN "pricesExclVat" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sales" ALTER COLUMN "pricesExclVat" SET DEFAULT true;

-- 2. Product prices become net, so what the customer pays stays the same:
--    net = gross − round(gross × rate / (100 % + rate)), half away from zero (= splitGross).
UPDATE "products"
SET "priceCents" = "priceCents" - ROUND("priceCents"::numeric * "vatRateBp" / (10000 + "vatRateBp"))::int;

-- 3. Open carts (PARKED, no cart discount) switch to the new pricing too:
--    product lines keep the customer's price (unit price / discount converted to net),
--    typed lines (labour, free text) keep the typed amount and get VAT on top.
CREATE TEMP TABLE "_flip" AS
SELECT "id" FROM "sales" WHERE "status" = 'PARKED' AND "cartDiscountCents" = 0;

UPDATE "sale_lines" l
SET "unitPriceCents" = l."unitPriceCents" - ROUND(l."unitPriceCents"::numeric * l."vatRateBp" / (10000 + l."vatRateBp"))::int,
    "discountCents"  = l."discountCents"  - ROUND(l."discountCents"::numeric  * l."vatRateBp" / (10000 + l."vatRateBp"))::int
WHERE l."saleId" IN (SELECT "id" FROM "_flip") AND l."productId" IS NOT NULL;

UPDATE "sale_lines" l
SET "lineNetCents" = GREATEST(0, ROUND(l."qty" * l."unitPriceCents")::int - l."discountCents")
WHERE l."saleId" IN (SELECT "id" FROM "_flip");

UPDATE "sale_lines" l
SET "lineGrossCents" = ROUND(l."lineNetCents"::numeric * (10000 + l."vatRateBp") / 10000)::int
WHERE l."saleId" IN (SELECT "id" FROM "_flip");

UPDATE "sale_lines" l
SET "lineVatCents" = l."lineGrossCents" - l."lineNetCents"
WHERE l."saleId" IN (SELECT "id" FROM "_flip");

UPDATE "sales" s
SET "pricesExclVat"   = true,
    "totalGrossCents" = COALESCE((SELECT SUM("lineGrossCents") FROM "sale_lines" WHERE "saleId" = s."id"), 0),
    "totalVatCents"   = COALESCE((SELECT SUM("lineVatCents")   FROM "sale_lines" WHERE "saleId" = s."id"), 0),
    "totalNetCents"   = COALESCE((SELECT SUM("lineNetCents")   FROM "sale_lines" WHERE "saleId" = s."id"), 0)
WHERE s."id" IN (SELECT "id" FROM "_flip");

DROP TABLE "_flip";
