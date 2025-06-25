import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase URL or service role key in environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Test the connection
async function testConnection() {
  try {
    // Using underscore prefix to indicate intentionally unused variable
    const { error } = await supabase.from('health_check').select('*').limit(1);
    if (error) throw error;
    console.log('✅ Connected to Supabase');
    return true;
  } catch (error) {
    console.error('❌ Error connecting to Supabase:', error.message);
    return false;
  }
}

export { supabase, testConnection };
