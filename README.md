# High-Performance Keyset-Paginated Catalog

This project demonstrates a production-grade product catalog API containing **200,000 products** built using Node.js, TypeScript, Fastify, and a Neon PostgreSQL database. It utilizes **keyset (cursor-based) pagination** and composite indexing to ensure performance scales at $O(\log N)$ and prevents data drift under concurrent writes.

---

## Technical Deep-Dive

### 1. Why Offset-Based Pagination Fails

Traditional pagination using `LIMIT L OFFSET O` scales poorly in production due to two primary issues:

#### A. Performance Degradation ($O(N)$ execution)
When executing `LIMIT 20 OFFSET 100000`, PostgreSQL cannot jump directly to row 100,000. It must perform an index/seq scan, retrieve all 100,020 rows, sort them, discard the first 100,000 rows, and return the remaining 20.
As the offset ($O$) grows, database response time and CPU utilization scale linearly ($O(N)$), leading to slow queries, database locks, and potential timeouts on large datasets.

#### B. Data Drift (Duplicates and Gaps)
Under real-time concurrent writes, offset pagination results in a volatile user experience:
* **Duplicates**: If a user is viewing Page 1, and 5 new products are added, all existing products shift down by 5 slots. When the user navigates to Page 2 (`OFFSET 20`), the last 5 products from Page 1 are shifted into Page 2, showing duplicate items.
* **Missing Items**: Conversely, if 5 products are deleted from Page 1, items shift up. When the user requests Page 2, 5 products are skipped entirely.

**The Keyset Solution**: Keyset pagination solves both problems. By querying relative to an immutable checkpoint (the cursor `(created_at, id)`), PostgreSQL can perform a B-Tree search directly to that specific index point and scan forward, ensuring stable, $O(\log N)$ performance and zero duplicate/skipped items, regardless of concurrent updates.

---

### 2. Composite Index Mechanics vs. Filesort

To paginate sorted by "newest first" (`created_at DESC, id DESC`), the database executes:
```sql
SELECT id, name, category, price, created_at, updated_at
FROM products
WHERE category = 'Electronics' 
  AND (created_at < '2026-06-26T18:00:00.000Z' 
       OR (created_at = '2026-06-26T18:00:00.000Z' AND id < '4b49cf52-78d1-4475-b6d4-d576a91712a2'))
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

Our composite index is structured as:
```sql
CREATE INDEX idx_products_category_created_at_id 
ON products (category, created_at DESC, id DESC);
```

#### How it avoids Filesort
1. **Equality Filtering**: PostgreSQL matches the leading column `category` in the index. This narrows the search space to only rows where `category = 'Electronics'`.
2. **Pre-Sorted Order**: Within the subset of 'Electronics', the B-Tree index keeps entries sorted by `created_at DESC` and then `id DESC`. Because the query's `ORDER BY` clause matches the index sort directions exactly, the database engine reads values directly in their sorted state, completely avoiding an in-memory or on-disk **Filesort (Sort node)**.
3. **Logarithmic Seek**: The inequality `(created_at, id) < (cursor_time, cursor_uuid)` allows the engine to perform a B-Tree range search in $O(\log N)$ time to find the first index key matching the cursor, and then read the next 20 items sequentially.

---

### 3. AI Acceleration with Performance Constraints

Using AI as a pair programmer allowed us to achieve rapid, production-grade prototyping while retaining complete control over performance constraints:
* **High-Performance Ingestion**: Instead of relying on slow ORM entities or naive loops that execute individual queries, we utilized PostgreSQL's `UNNEST` function to batch-insert 200,000 records. The AI generated the array mapping logic, which we combined with raw query parameters to ensure the entire insertion process completed in under 10 seconds.
* **Precise SQL Control**: By using the raw `pg` driver, we bypassed ORM abstractions that often struggle to represent complex row-value comparisons, allowing us to enforce clean, parameter-safe keyset SQL conditions.
* **Fastify Route Validation & Pagination Boundaries**: The AI helped implement the standard `limit + 1` trick to check for the existence of subsequent pages without executing a separate `COUNT(*)` query, lowering query load on the database.

---

## Project Setup & Usage

### 1. Requirements
* Node.js (v18+)
* Neon PostgreSQL (or any PostgreSQL instance)

### 2. Installation
Install all dependencies:
```bash
npm install
```

### 3. Database Configuration
Create a `.env` file in the root directory and add your connection string. If you are using Neon, make sure to add `?sslmode=require`:
```env
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
PORT=3000
HOST=127.0.0.1
```

### 4. Create Database Schema
Execute the queries in [schema.sql](file:///c:/Users/Vaibhav%20Shivhare/Desktop/codevector/schema.sql) against your database. You can do this via the Neon console SQL editor or standard CLI:
```bash
psql -d "your-neon-database-url" -f schema.sql
```

### 5. Run the Seed Script
Populate the database with 200,000 products:
```bash
npm run seed
```

### 6. Run the Server
Start the development server:
```bash
npm run dev
```

### 7. Test the API
* **Initial Page**:
  `GET http://localhost:3000/api/products?limit=20`
* **Filter by Category**:
  `GET http://localhost:3000/api/products?category=Electronics&limit=10`
* **Retrieve Next Page**:
  Copy the `next_cursor` Base64 string from the previous response and pass it:
  `GET http://localhost:3000/api/products?cursor=<base64_string>&limit=20`
