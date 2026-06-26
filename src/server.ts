import Fastify from 'fastify';
import dotenv from 'dotenv';
import { productRoutes } from './routes.js';
import { pool, testConnection } from './db.js';

// Load environment variables
dotenv.config();

const fastify = Fastify({
  logger: true // Production-grade JSON logger
});

// Register routes
fastify.register(productRoutes);

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '127.0.0.1';

async function start() {
  try {
    // 1. Test database connection before launching server
    const isDbConnected = await testConnection();
    if (!isDbConnected) {
      fastify.log.error('CRITICAL: Cannot connect to Neon Database. Exiting.');
      process.exit(1);
    }

    // 2. Start Listening
    await fastify.listen({ port: PORT, host: HOST });
    fastify.log.info(`Server successfully listening on http://${HOST}:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

// Graceful shutdown logic for handling process interrupts (SIGINT/SIGTERM)
async function closeGracefully(signal: string) {
  fastify.log.info(`Received ${signal}. Starting graceful shutdown...`);
  try {
    // Stop accepting new HTTP requests
    await fastify.close();
    fastify.log.info('HTTP server closed.');

    // Drain and close database connection pool
    await pool.end();
    fastify.log.info('Database connection pool terminated.');

    process.exit(0);
  } catch (err: any) {
    fastify.log.error('Error during graceful shutdown:', err.message);
    process.exit(1);
  }
}

process.on('SIGINT', () => closeGracefully('SIGINT'));
process.on('SIGTERM', () => closeGracefully('SIGTERM'));

start();
