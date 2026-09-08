const { createClient } = require('@supabase/supabase-js');

const url = process.env.VITE_SUPABASE_URL;
const publicKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !publicKey) throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY');
const supabase = createClient(url, publicKey);

async function test() {
  const { error } = await supabase
    .from('profiles')
    .select('user_id, display_name, avatar_url, user_roles(role, can_view_sales, crm_access, commission_rate)')
    .order('created_at', { ascending: false })
    .limit(10);
  console.log('Error:', error);
}
test();
