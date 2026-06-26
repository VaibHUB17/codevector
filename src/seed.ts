import { randomUUID } from 'crypto';
import { pool, testConnection } from './db.js';

const BATCH_SIZE = 10000;
const TOTAL_RECORDS = 200000;

const CATEGORIES = [
  'Electronics', 'Apparel', 'Home & Kitchen', 'Beauty', 'Sports', 
  'Books', 'Automotive', 'Toys', 'Health', 'Garden'
];

const ADJECTIVES = [
  'Premium', 'Wireless', 'Ergonomic', 'Eco-Friendly', 'Portable', 
  'Smart', 'Luxury', 'Classic', 'Heavy-Duty', 'Minimalist',
  'Ultra-Slim', 'Pro-Series', 'Tactical', 'Compact', 'Vintage'
];

const NOUNS = [
  'Gadget', 'Backpack', 'Chair', 'Serum', 'Dumbbell', 
  'Novel', 'Tool', 'Drone', 'Supplement', 'Trimmer',
  'Monitor', 'Keyboard', 'Speaker', 'Headphones', 'Water-Bottle'
];

function generateProduct(index: number) {
  // Use deterministic modulo indexing for category to ensure equal distribution
  const category = CATEGORIES[index % CATEGORIES.length];
  
  // Random adjective/noun selection for variety
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const name = `${adj} ${noun} #${index + 1}`;
  
  const price = parseFloat((Math.random() * 990 + 9.99).toFixed(2));
  
  // Linearly distribute created_at timestamps backwards from now by 12 seconds per item
  // This guarantees distinct timestamps spanning approximately 27 days
  const createdAt = new Date(Date.now() - index * 12000);
  const updatedAt = createdAt;
  const id = randomUUID();
  
  return { id, name, category, price, createdAt, updatedAt };
}

async function seed() {
  console.log('Starting seed process...');
  const isConnected = await testConnection();
  if (!isConnected) {
    console.error('Aborting seed: Unable to connect to the database.');
    process.exit(1);
  }

  const startTime = Date.now();
  const client = await pool.connect();

  try {
    console.log('Truncating existing products table...');
    await client.query('TRUNCATE TABLE products;');
    
    // Disable index temporarily or let PG handle it? Neon handles it fine, but we can just insert.
    console.log(`Generating and inserting ${TOTAL_RECORDS} products in batches of ${BATCH_SIZE}...`);
    
    const query = `
      INSERT INTO products (id, name, category, price, created_at, updated_at)
      SELECT * FROM UNNEST(
        $1::uuid[], 
        $2::text[], 
        $3::text[], 
        $4::numeric[], 
        $5::timestamptz[], 
        $6::timestamptz[]
      )
    `;

    for (let i = 0; i < TOTAL_RECORDS; i += BATCH_SIZE) {
      const batchStartTime = Date.now();
      
      const ids: string[] = [];
      const names: string[] = [];
      const categories: string[] = [];
      const prices: number[] = [];
      const createdAts: Date[] = [];
      const updatedAts: Date[] = [];

      for (let j = 0; j < BATCH_SIZE; j++) {
        const prod = generateProduct(i + j);
        ids.push(prod.id);
        names.push(prod.name);
        categories.push(prod.category);
        prices.push(prod.price);
        createdAts.push(prod.createdAt);
        updatedAts.push(prod.updatedAt);
      }

      await client.query(query, [ids, names, categories, prices, createdAts, updatedAts]);
      
      const batchTime = Date.now() - batchStartTime;
      console.log(`Inserted batch ${i / BATCH_SIZE + 1}/${TOTAL_RECORDS / BATCH_SIZE} (${BATCH_SIZE} products) in ${batchTime}ms`);
    }

    const duration = (Date.now() - startTime) / 1000;
    console.log(`\nSuccess! Seeded ${TOTAL_RECORDS} products successfully in ${duration.toFixed(2)} seconds.`);
  } catch (error: any) {
    console.error('Error during seeding:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
