const { createClient } = require('@supabase/supabase-js');

const url = process.env.VITE_SUPABASE_URL;
const publicKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const password = process.env.TEST_USER_PASSWORD;
if (!url || !publicKey || !password) {
  throw new Error('Set VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, and TEST_USER_PASSWORD');
}
const supabase = createClient(url, publicKey);

async function test() {
  const { error } = await supabase.auth.signUp({
    email: `test${Date.now()}@example.invalid`,
    password,
    options: { data: { display_name: 'Test User' } },
  });
  console.log('Error:', error);
}
test();
