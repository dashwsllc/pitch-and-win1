import { createClient } from '@supabase/supabase-js'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

// Explicit opt-in: temporary isolated accounts; no existing account or sale is mutated.
if (!process.argv.includes('--run-disposable-check')) throw new Error('Use --run-disposable-check to create and clean up temporary verification accounts.')
const project = 'mbzwchnxtskysqplqiyy'
const url = `https://${project}.supabase.co`
const command = spawnSync('npx', ['supabase','projects','api-keys','--project-ref',project,'--output','json'], {
  shell: process.platform === 'win32', encoding:'utf8', maxBuffer:1024*1024,
})
if (command.status !== 0) throw new Error('Could not read authorized project credentials')
const keys = JSON.parse(command.stdout)
const serviceKey = keys.find(k => k.name === 'service_role')?.api_key
const publicKey = keys.find(k => k.name === 'anon')?.api_key
assert(serviceKey && publicKey, 'Project API keys unavailable')
const options = { auth:{persistSession:false,autoRefreshToken:false} }
const admin = createClient(url,serviceKey,options)
const executive = createClient(url,publicKey,options)
const seller = createClient(url,publicKey,options)
const suffix = randomUUID().slice(0,8)
const password = `Verify-${randomUUID()}!`
const newPassword = `Updated-${randomUUID()}!`
const users = []
const sales = []
const clients = [admin,executive,seller]
let checkpoint = 'setup'
const must = response => { if (response.error) throw new Error(response.error.message); return response.data }
const step = name => { checkpoint=name; console.log(`Checking: ${name}`) }
try {
  for (const name of ['Executive','Seller']) {
    const data = must(await admin.auth.admin.createUser({email:`qa-${name.toLowerCase()}-${suffix}@example.invalid`,password,email_confirm:true,user_metadata:{display_name:`Verificação temporária ${name}`}}))
    users.push(data.user)
  }
  const [actor,target] = users
  must(await admin.from('user_roles').insert({user_id:actor.id,role:'executive'}))
  must(await admin.from('user_roles').update({commission_rate:20}).eq('user_id',target.id))
  must(await executive.auth.signInWithPassword({email:actor.email,password}))
  must(await seller.auth.signInWithPassword({email:target.email,password}))

  step('authoritative last login')
  const authBefore = must(await admin.auth.admin.getUserById(target.id)).user
  const directory = must(await executive.rpc('executive_list_users'))
  const account = directory.users.find(u => u.user_id===target.id)
  assert.equal(Date.parse(account.last_sign_in_at),Date.parse(authBefore.last_sign_in_at))
  assert(account.last_sign_in_at && authBefore.last_sign_in_at)

  step('Auth Admin account transaction')
  const form = {user_id:target.id,display_name:'Verificação temporária atualizada',email:`qa-updated-${suffix}@example.invalid`,phone:'',avatar_url:'',
    roles:['seller','sdr'],commission_rate:0,crm_access:true,can_view_sales:false,suspended:false,
    password:newPassword,reason:'Verificação técnica temporária da edição de conta',expected_revision:account.account_revision,expected_updated_at:account.updated_at}
  const response = await executive.functions.invoke('executive-update-account',{body:form})
  if (response.error) {
    const body = await response.error.context?.json?.().catch(() => null)
    throw new Error(body?.error || response.error.message)
  }
  assert.equal(response.data?.success,true)
  const authAfter = must(await admin.auth.admin.getUserById(target.id)).user
  assert.equal(authAfter.email,form.email)
  assert.equal(authAfter.last_sign_in_at,authBefore.last_sign_in_at, 'Editing an account must not alter last login')
  const profile = must(await admin.from('profiles').select('display_name').eq('user_id',target.id).single())
  assert.equal(profile.display_name,form.display_name)
  const roles = must(await admin.from('user_roles').select('role,commission_rate,crm_access').eq('user_id',target.id))
  assert.equal(roles.length,2)
  assert(roles.every(r => r.commission_rate===0 && r.crm_access))
  const stale = await executive.functions.invoke('executive-update-account',{body:form})
  assert(stale.error, 'Stale changes should be rejected')
  must(await seller.auth.signInWithPassword({email:form.email,password:newPassword}))
  const denied = await seller.functions.invoke('executive-update-account',{body:form})
  assert(denied.error,'Seller must not edit accounts administratively')
  assert((await seller.rpc('executive_list_users')).error,'Private Auth directory requires executive')

  step('audited compatibility password reset')
  const resetPassword = `Reset-${randomUUID()}!`
  const authBeforeReset = must(await admin.auth.admin.getUserById(target.id)).user
  const reset = await executive.functions.invoke('reset-user-password', {body:{user_id:target.id,new_password:resetPassword,reason:'Verificação técnica da redefinição administrativa'}})
  if (reset.error) {
    const body = await reset.error.context?.json?.().catch(() => null)
    throw new Error(body?.error || reset.error.message)
  }
  assert.equal(reset.data?.success,true)
  assert.equal(must(await admin.auth.admin.getUserById(target.id)).user.last_sign_in_at,authBeforeReset.last_sign_in_at)
  must(await seller.auth.signInWithPassword({email:form.email,password:resetPassword}))
  const accountAudit = must(await executive.from('executive_audit_events').select('action,reason').eq('target_id',target.id))
  assert(accountAudit.some(row => row.reason==='Verificação técnica da redefinição administrativa'))

  step('Realtime signal and shared sale lifecycle')
  const visibleTopics = must(await seller.from('dashboard_events').select('topic'))
  assert(visibleTopics.some(row => row.topic==='sales'),'Seller must be able to read the sales signal')
  assert(!visibleTopics.some(row => row.topic==='users'),'Seller must not read private Auth signals')
  await seller.realtime.setAuth(must(await seller.auth.getSession()).session.access_token)
  let eventResolve
  const signal = new Promise(resolve => { eventResolve=resolve })
  const channel = seller.channel(`qa-sales-${suffix}`)
    .on('system',{}, message => console.log('Realtime system:', message.status, message.message))
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'dashboard_events',filter:'topic=eq.sales'}, payload => { console.log('Realtime received:', payload.eventType, payload.errors || 'no errors'); eventResolve(true) })
  await new Promise((resolve,reject) => {
    const timeout = setTimeout(() => reject(new Error('Realtime subscription timeout')),15000)
    channel.subscribe(status => { if(status==='SUBSCRIBED'){clearTimeout(timeout);resolve()} else if(status==='CHANNEL_ERROR'){clearTimeout(timeout);reject(new Error('Realtime subscription rejected'))} })
  })
  const sale = must(await seller.from('vendas').insert({user_id:target.id,nome_produto:`Verificação temporária ${suffix}`,valor_venda:1,nome_comprador:'Comprador temporário',email_comprador:'qa-buyer@example.invalid',whatsapp_comprador:'00000000000'}).select('id').single())
  sales.push(sale.id)
  let signalTimeout
  const signaled = await Promise.race([signal,new Promise(resolve => { signalTimeout=setTimeout(() => resolve(false),15000) })])
  clearTimeout(signalTimeout)
  assert(signaled,'Realtime sales signal should reach seller')
  const pending = must(await seller.rpc('get_sales_board',{p_status:'pendente',p_search:suffix}))
  assert.equal(pending.total,1)
  assert.equal(must(await seller.rpc('get_team_ranking')).find(row => row.user_id===target.id).totalVendas,0,'Pending sales do not enter competition')
  assert(!('email_comprador' in pending.items[0]),'Buyer details must not appear in shared feed')
  assert((await seller.rpc('executive_review_sale',{p_sale_id:sale.id,p_action:'approve'})).error,'Seller approval must fail')
  must(await executive.rpc('executive_review_sale',{p_sale_id:sale.id,p_action:'approve',p_reason:'OK',p_expected_status:'pendente'}))
  const approved = must(await seller.rpc('get_sales_board',{p_status:'aprovada',p_search:suffix}))
  assert.equal(approved.items[0].approval_status,'aprovada')
  assert.equal(must(await seller.rpc('get_team_ranking')).find(row => row.user_id===target.id).totalVendas,1,'Approved sale enters competition')
  const realSale = must(await admin.from('vendas').select('commission_amount').eq('id',sale.id).single())
  assert.equal(realSale.commission_amount,0,'Zero-rate approved commissions stay zero')
  must(await executive.rpc('executive_review_sale',{p_sale_id:sale.id,p_action:'delete',p_reason:'Remoção da venda de verificação técnica',p_expected_status:'aprovada'}))
  assert.equal(must(await seller.rpc('get_sales_board',{p_status:'all',p_search:suffix})).total,0)
  assert.equal(must(await seller.rpc('get_team_ranking')).find(row => row.user_id===target.id).totalVendas,0,'Deleted sale is removed from competition')
  const audit = must(await executive.from('executive_audit_events').select('action').eq('target_id',sale.id))
  assert(audit.some(e => e.action==='sale.delete'))
  await seller.removeChannel(channel)
  console.log('PASS: real Auth update/login, password change, zero commission, stale-edit rejection, role restrictions, Realtime delivery, shared pending/approved feed, deletion and audit')
} catch(error) {
  console.error(`FAIL at ${checkpoint}: ${error.message}`)
  process.exitCode=1
} finally {
  const cleanupErrors=[]
  for(const id of sales) {
    const response=await admin.from('vendas').delete().eq('id',id)
    if(response.error) cleanupErrors.push('temporary sale')
  }
  const ids=[...users.map(u => u.id),...sales]
  if(ids.length) {
    const response=await admin.from('executive_audit_events').delete().in('target_id',ids)
    if(response.error) cleanupErrors.push('temporary audit')
  }
  for(const account of users.reverse()) {
    for(const table of ['saldos_disponiveis','saques']) {
      const response=await admin.from(table).delete().eq('user_id',account.id)
      if(response.error) cleanupErrors.push(`temporary ${table}`)
    }
    const response=await admin.auth.admin.deleteUser(account.id)
    if(response.error) cleanupErrors.push(`temporary account ${account.id}`)
  }
  for(const client of clients) await client.removeAllChannels()
  if(cleanupErrors.length){console.error('CLEANUP REQUIRED: '+cleanupErrors.join(', '));process.exitCode=1}
  else console.log('Cleanup complete: temporary accounts, sales and audit records removed.')
}
