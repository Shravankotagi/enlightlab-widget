const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Load environment variables manually from .env
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      process.env[key] = value;
    }
  });
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

console.log("Connecting to Supabase...");
console.log(`URL: ${SUPABASE_URL}`);
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function testConnection() {
  try {
    // 1. Try querying the knowledge_base table
    console.log("\n1. Testing query on 'knowledge_base' table...");
    const { data, error } = await supabase
      .from('knowledge_base')
      .select('count')
      .limit(1);

    if (error) {
      console.error("❌ Failed to query 'knowledge_base' table:", error.message);
      console.error("Please make sure you have run the schema creation SQL script in your SQL Editor.");
    } else {
      console.log("✅ Successfully queried 'knowledge_base' table!");
    }

    // 2. Try testing the match_documents function
    console.log("\n2. Testing RPC match_documents function...");
    const dummyVector = Array(3072).fill(0.0);
    const { data: rpcData, error: rpcError } = await supabase.rpc('match_documents', {
      query_embedding: dummyVector,
      match_threshold: 0.1,
      match_count: 1
    });

    if (rpcError) {
      console.error("❌ Failed to invoke 'match_documents' RPC:", rpcError.message);
      console.error("Please make sure you have created the match_documents function in your SQL Editor.");
    } else {
      console.log("✅ Successfully invoked 'match_documents' RPC function!");
    }

  } catch (err) {
    console.error("❌ Unexpected error:", err);
  }
}

testConnection();
