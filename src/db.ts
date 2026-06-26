import pg from 'pg';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('ERROR: DATABASE_URL environment variable is missing.');
  process.exit(1);
}

// Determine if we need SSL based on the host. Neon DB requires SSL.
const isLocal = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');

export const pool = new pg.Pool({
  connectionString,
  // Configure SSL for remote databases (like Neon), bypass for local testing if local IP/localhost is detected.
  ssl: isLocal ? false : { rejectUnauthorized: false },
  
  // Production-grade pooling configurations
  max: 20,                          // Maximum number of connections in the pool
  idleTimeoutMillis: 30000,         // How long a client is allowed to remain idle before being closed
  connectionTimeoutMillis: 10000,    // Return an error if a connection cannot be established within 10 seconds
});

// Global pool error handler to prevent crashing on sudden connection failures
pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err.message);
});

export async function testConnection(): Promise<boolean> {
  let client;
  try {
    client = await pool.connect();
    const res = await client.query('SELECT NOW()');
    console.log(`Database connected successfully. Server time: ${res.rows[0].now}`);
    return true;
  } catch (err: any) {
    console.error('Database connection test failed:', err.message);
    return false;
  } finally {
    if (client) client.release();
  }
}
