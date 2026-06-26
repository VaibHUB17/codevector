-- Enable gen_random_uuid() which is built-in in PostgreSQL 13+
-- If needed, we can also enable pg_trgm or other extensions, but gen_random_uuid() is standard.

CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    price NUMERIC(12, 2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for optimized keyset pagination and category filtering:
-- Query: WHERE category = X AND (created_at, id) < (Y, Z) ORDER BY created_at DESC, id DESC LIMIT L
-- The composite index leads with the equality column (category), and follows the exact sorting order
-- (created_at DESC, id DESC). This allows PostgreSQL to do an Index Scan and retrieve rows in order without filesort.
CREATE INDEX IF NOT EXISTS idx_products_category_created_at_id 
ON products (category, created_at DESC, id DESC);

-- Index for pagination without category filtering (optional but good practice if category filter is omitted)
CREATE INDEX IF NOT EXISTS idx_products_created_at_id 
ON products (created_at DESC, id DESC);

-- Trigger to automatically update updated_at on modify
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_products_updated_at ON products;
CREATE TRIGGER update_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
