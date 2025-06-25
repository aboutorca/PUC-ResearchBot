import { Pinecone } from '@pinecone-database/pinecone';
import 'dotenv/config';

// Initialize Pinecone client
const pineconeApiKey = process.env.PINECONE_API_KEY;
const pineconeEnvironment = process.env.PINECONE_ENVIRONMENT;
const pineconeIndex = process.env.PINECONE_INDEX;

if (!pineconeApiKey || !pineconeEnvironment || !pineconeIndex) {
  throw new Error('Missing Pinecone configuration in environment variables');
}

const pinecone = new Pinecone({
  apiKey: pineconeApiKey,
  environment: pineconeEnvironment,
});

// Test the connection
async function testConnection() {
  try {
    const indexes = await pinecone.listIndexes();
    console.log('✅ Connected to Pinecone');
    console.log('Available indexes:', indexes);
    return true;
  } catch (error) {
    console.error('❌ Error connecting to Pinecone:', error.message);
    return false;
  }
}

export { pinecone, testConnection };
