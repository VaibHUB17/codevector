import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import { pool } from './db.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const indexHtmlPath = path.join(__dirname, '../public/index.html');

interface ProductsQuery {
  category?: string;
  limit?: string;
  cursor?: string;
}

export async function productRoutes(fastify: FastifyInstance, options: FastifyPluginOptions) {
  // Root path serves the beautiful single-page dashboard UI
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const html = await fs.readFile(indexHtmlPath, 'utf8');
      return reply.type('text/html').send(html);
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send('Error loading frontend UI. Make sure public/index.html exists.');
    }
  });

  fastify.get('/api/products', async (request: FastifyRequest<{ Querystring: ProductsQuery }>, reply: FastifyReply) => {
    const { category, limit: limitStr, cursor } = request.query;

    // 1. Parse and validate the limit (default: 20, max limit: 100 for API safety)
    let limit = 20;
    if (limitStr) {
      const parsedLimit = parseInt(limitStr, 10);
      if (!isNaN(parsedLimit) && parsedLimit > 0) {
        limit = Math.min(parsedLimit, 100);
      }
    }

    // 2. Decode and validate the cursor
    let cursorTime: Date | null = null;
    let cursorId: string | null = null;

    if (cursor) {
      try {
        const decoded = Buffer.from(cursor, 'base64').toString('utf8');
        const parts = decoded.split('|');
        if (parts.length === 2) {
          const rawTime = parts[0];
          const rawId = parts[1];

          const parsedTime = new Date(rawTime);
          // Regex to validate standard UUID v4 format
          const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

          if (!isNaN(parsedTime.getTime()) && uuidRegex.test(rawId)) {
            cursorTime = parsedTime;
            cursorId = rawId;
          } else {
            return reply.status(400).send({
              error: 'Bad Request',
              message: 'Malformed cursor: cursor must contain a valid ISO timestamp and UUID.'
            });
          }
        } else {
          return reply.status(400).send({
            error: 'Bad Request',
            message: 'Invalid cursor format. Expected base64(ISO_timestamp|UUID).'
          });
        }
      } catch (err) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Invalid base64 cursor string.'
        });
      }
    }

    // 3. Build dynamic PostgreSQL query parameters and clauses
    const queryParams: any[] = [];
    const conditions: string[] = [];

    // Filter by Category
    if (category) {
      queryParams.push(category);
      conditions.push(`category = $${queryParams.length}`);
    }

    // Apply Keyset Pagination condition
    if (cursorTime && cursorId) {
      queryParams.push(cursorTime, cursorId);
      const timeParamIdx = queryParams.length - 1; // 1-indexed placeholder index
      const idParamIdx = queryParams.length;       // 1-indexed placeholder index
      
      // Keyset: (created_at < cursorTime) OR (created_at = cursorTime AND id < cursorId)
      // Since sorting is (created_at DESC, id DESC), older items appear later.
      conditions.push(
        `(created_at < $${timeParamIdx} OR (created_at = $${timeParamIdx} AND id < $${idParamIdx}))`
      );
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // To determine if there is a next page without a second COUNT(*) query,
    // we query limit + 1 records.
    queryParams.push(limit + 1);
    const limitParamIdx = queryParams.length;

    const sql = `
      SELECT id, name, category, price, created_at, updated_at 
      FROM products
      ${whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT $${limitParamIdx}
    `;

    try {
      const result = await pool.query(sql, queryParams);
      const rows = result.rows;

      // Check if we retrieved the extra boundary row
      const hasNextPage = rows.length > limit;
      // Truncate products to the requested page size
      const pageProducts = hasNextPage ? rows.slice(0, limit) : rows;

      // 4. Generate next cursor if there are more items
      let nextCursor: string | null = null;
      if (hasNextPage && pageProducts.length > 0) {
        const lastProduct = pageProducts[pageProducts.length - 1];
        
        // Ensure timestamp is in ISO format
        const createdAtStr = lastProduct.created_at instanceof Date 
          ? lastProduct.created_at.toISOString() 
          : new Date(lastProduct.created_at).toISOString();

        const rawCursor = `${createdAtStr}|${lastProduct.id}`;
        nextCursor = Buffer.from(rawCursor).toString('base64');
      }

      // Convert database NUMERIC (string) to JS float
      const formattedProducts = pageProducts.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        price: parseFloat(p.price),
        created_at: p.created_at,
        updated_at: p.updated_at,
      }));

      return reply.send({
        products: formattedProducts,
        next_cursor: nextCursor
      });
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve products from database.'
      });
    }
  });
}
