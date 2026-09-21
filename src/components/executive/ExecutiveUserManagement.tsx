import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Clock3, ImagePlus, KeyRound, Loader2, Pencil, RefreshCw, Search, ShieldCheck, Trash2, Users, X } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ROLE_LABELS, useAllUsers, useRoles, type ExecutiveUser, type UserRole } from '@/hooks/useRoles'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/use-toast'
import { supabase } from '@/integrations/supabase/client'
import { errorMessage, exactDate } from '@/lib/sales'
import { avatarObjectPath, validateAvatarFile } from '@/lib/avatar'
import { firstIssue, strongPasswordSchema } from '@/lib/auth-security'

interface AccountForm {
  display_name: string
  email: string
  phone: string
  avatar_url: string
  password: string
  confirm_password: string
  roles: UserRole[]
  commission_rate: string
  crm_access: boolean
  can_view_sales: boolean
  suspended: boolean
  reason: string
}

export function ExecutiveUserManagement({ compact = false }: { compact?: boolean } = {}) {
  const { users, loading, refetch, fetchedAt, error, isFetching } = useAllUsers()
  const { hasRole } = useRoles()
  const { user: actor } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<ExecutiveUser | null>(null)
  const [form, setForm] = useState<AccountForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [avatarRemoved, setAvatarRemoved] = useState(false)
  const avatarInput = useRef<HTMLInputElement>(null)
  const [deleting, setDeleting] = useState<ExecutiveUser | null>(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)

  const open = (account: ExecutiveUser) => {
    setAvatarFile(null)
    setAvatarRemoved(false)
    setEditing(account)
    setForm({
      display_name: account.display_name ?? '', email: account.email ?? '', phone: account.phone ? `+${account.phone.replace(/^\+/, '')}` : '',
      avatar_url: account.avatar_url ?? '', password: '', confirm_password: '',
      roles: account.user_roles.length ? account.user_roles.map(r => r.role) : ['seller'],
      commission_rate: String(account.user_roles[0]?.commission_rate ?? 10),
      crm_access: account.user_roles.some(r => r.crm_access),
      can_view_sales: account.user_roles.some(r => r.can_view_sales),
      suspended: account.suspended, reason: '',
    })
  }
  const change = <K extends keyof AccountForm>(key: K, value: AccountForm[K]) => setForm(current => current && ({ ...current, [key]: value }))
  const close = () => { if (!saving) { setEditing(null); setForm(null); setAvatarFile(null); setAvatarRemoved(false) } }

  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreview(null)
      return
    }
    const preview = URL.createObjectURL(avatarFile)
    setAvatarPreview(preview)
    return () => URL.revokeObjectURL(preview)
  }, [avatarFile])

  const selectAvatar = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      await validateAvatarFile(file)
      setAvatarFile(file)
      setAvatarRemoved(false)
    } catch (cause) {
      toast({ title: 'Imagem inválida', description: errorMessage(cause), variant: 'destructive' })
    }
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!editing || !form || saving) return
    if (form.password !== form.confirm_password) { toast({ title: 'As senhas não coincidem', variant: 'destructive' }); return }
    if (form.password) {
      const passwordResult = strongPasswordSchema.safeParse(form.password)
      if (!passwordResult.success) { toast({ title: firstIssue(passwordResult.error), variant: 'destructive' }); return }
    }
    if (!form.roles.length || form.reason.trim().length < 5 || form.commission_rate.trim() === '') {
      toast({ title: 'Confira os papéis, a comissão e o motivo da alteração.', variant: 'destructive' }); return
    }
    setSaving(true)
    let uploadedAvatarPath: string | null = null
    let accountUpdated = false
    try {
      let nextAvatarUrl = avatarRemoved ? '' : form.avatar_url
      if (avatarFile) {
        const extension = await validateAvatarFile(avatarFile)
        uploadedAvatarPath = `${editing.user_id}/${crypto.randomUUID()}.${extension}`
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(uploadedAvatarPath, avatarFile, {
            upsert: false,
            contentType: avatarFile.type,
            cacheControl: '3600',
          })
        if (uploadError) throw new Error('Não foi possível enviar a imagem. Tente novamente.')
        nextAvatarUrl = supabase.storage.from('avatars').getPublicUrl(uploadedAvatarPath).data.publicUrl
      }
      const { confirm_password: _confirmation, ...payload } = form
      const { data, error: functionError } = await supabase.functions.invoke('executive-update-account', {
        body: { ...payload, avatar_url: nextAvatarUrl, commission_rate: Number(form.commission_rate), user_id: editing.user_id,
          expected_revision: editing.account_revision, expected_updated_at: editing.updated_at },
      })
      if (functionError) {
        let message = errorMessage(functionError)
        if ('context' in functionError && functionError.context instanceof Response) {
          const body = await functionError.context.json().catch(() => null)
          if (body?.error) message = body.error
        }
        throw new Error(message)
      }
      if (!data?.success) throw new Error(data?.error || 'Não foi possível confirmar a atualização.')
      accountUpdated = true
      const previousAvatarPath = avatarObjectPath(editing.avatar_url, editing.user_id)
      if ((avatarFile || avatarRemoved) && previousAvatarPath && previousAvatarPath !== uploadedAvatarPath) {
        await supabase.storage.from('avatars').remove([previousAvatarPath])
      }
      toast({ title: 'Conta atualizada', description: 'Dados, acesso e histórico administrativo sincronizados.' })
      setEditing(null); setForm(null); setAvatarFile(null); setAvatarRemoved(false)
      await queryClient.invalidateQueries({ queryKey: ['executive-users'] })
      void queryClient.invalidateQueries({ queryKey: ['profile', editing.user_id] })
      void queryClient.invalidateQueries({ queryKey: ['executive-audit'] })
      void queryClient.invalidateQueries({ queryKey: ['team-ranking'] })
      void queryClient.invalidateQueries({ queryKey: ['sales-board'] })
      window.dispatchEvent(new Event('dashboard-data-changed'))
      if (editing.user_id === actor?.id) await supabase.auth.refreshSession()
    } catch (err) {
      if (uploadedAvatarPath && !accountUpdated) {
        await supabase.storage.from('avatars').remove([uploadedAvatarPath])
      }
      toast({ title: 'Alteração não concluída', description: errorMessage(err), variant: 'destructive' })
    }
    finally { setSaving(false) }
  }

  const closeDelete = () => { if (!deleteBusy) { setDeleting(null); setDeleteReason('') } }
  const confirmDelete = async () => {
    if (!deleting || deleteBusy || deleteReason.trim().length < 5) return
    setDeleteBusy(true)
    try {
      const { data, error: functionError } = await supabase.functions.invoke('executive-delete-account', {
        body: { user_id: deleting.user_id, reason: deleteReason.trim() },
      })
      if (functionError) {
        let message = errorMessage(functionError)
        if ('context' in functionError && functionError.context instanceof Response) {
          const body = await functionError.context.json().catch(() => null)
          if (body?.error) message = body.error
        }
        throw new Error(message)
      }
      if (!data?.success) throw new Error(data?.error || 'Não foi possível confirmar a exclusão.')
      toast({ title: 'Conta excluída', description: 'Acesso removido e histórico de vendas, abordagens e saques preservado.' })
      setDeleting(null)
      setDeleteReason('')
      await queryClient.invalidateQueries({ queryKey: ['executive-users'] })
      void queryClient.invalidateQueries({ queryKey: ['executive-audit'] })
      void queryClient.invalidateQueries({ queryKey: ['team-ranking'] })
      window.dispatchEvent(new Event('dashboard-data-changed'))
    } catch (err) { toast({ title: 'Exclusão não concluída', description: errorMessage(err), variant: 'destructive' }) }
    finally { setDeleteBusy(false) }
  }

  const filtered = users.filter(account => (account.display_name + ' ' + account.email).toLowerCase().includes(search.toLowerCase()))
  return (
    <section className={`surface-panel overflow-hidden ${compact ? 'rounded-xl' : 'rounded-2xl'}`}>
      <div className={`flex flex-wrap items-center justify-between border-b border-white/[0.06] ${compact ? 'gap-2 p-4' : 'gap-3 p-6'}`}>
        <div><h2 className="flex items-center gap-2 text-lg font-medium text-white"><Users className="h-5 w-5 text-electric" /> Contas e permissões <span className="text-sm text-muted-foreground">{users.length}</span></h2><p className="mt-1 text-xs text-muted-foreground">Identidade, acesso e autenticação do seu time.</p></div>
        <Button variant="outline" size="sm" disabled={isFetching} onClick={() => refetch()}><RefreshCw className={`mr-2 h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />Atualizar</Button>
      </div>
      <div className={compact ? 'space-y-3 p-4' : 'space-y-4 p-4 sm:p-6'}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full sm:w-72"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="h-9 pl-9 text-xs" aria-label="Buscar conta por nome ou e-mail" placeholder="Buscar nome ou e-mail" value={search} onChange={e => setSearch(e.target.value)} /></div>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Clock3 className="h-3 w-3" />{fetchedAt ? `Consulta: ${exactDate(fetchedAt)} · Brasília` : 'Consultando autenticação…'}</p>
        </div>
        <div className={`bg-electric-violet/[0.07] text-xs leading-relaxed text-muted-foreground ${compact ? 'rounded-lg px-3 py-2' : 'rounded-xl px-4 py-3'}`}>Último login = última autenticação registrada pelo Supabase Auth, com segundos e fuso de Brasília. Os dados sincronizam quando há alterações; use Atualizar para consultar agora. Reabrir a página não conta como novo login.</div>
        {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">Não foi possível consultar as contas. {errorMessage(error)} Os horários abaixo, se presentes, são da última consulta bem-sucedida.</p>}
        {loading ? [1,2,3].map(i => <div key={i} className="h-24 animate-pulse rounded-xl bg-white/[0.03]" />) : filtered.map(account => {
          const protectedAccount = account.user_roles.some(r => r.role==='super_admin') && !hasRole('super_admin')
          return <article key={account.user_id} className={`flex flex-wrap items-center justify-between bg-white/[0.025] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)] ${compact ? 'gap-3 rounded-lg p-3' : 'gap-4 rounded-xl p-4'}`}>
            <div className="flex min-w-0 items-start gap-3">
              <Avatar className="h-10 w-10 rounded-xl"><AvatarImage src={account.avatar_url ?? ''} /><AvatarFallback className="rounded-xl bg-electric-violet/15 text-violet-200">{(account.display_name || account.email || '?').slice(0,2).toUpperCase()}</AvatarFallback></Avatar>
              <div className="min-w-0"><p className="break-words text-sm font-medium text-ash">{account.display_name || 'Sem nome'}{account.user_id===actor?.id && <span className="ml-2 text-[10px] text-ember">VOCÊ</span>}</p><p className="mt-1 break-all text-xs text-muted-foreground">{account.email || 'E-mail não registrado'}</p><div className="mt-2 flex flex-wrap gap-1">{account.user_roles.map(r => <Badge key={r.role} className="border-0 bg-white/[0.06] text-[10px] font-normal text-muted-foreground">{ROLE_LABELS[r.role]}</Badge>)}{account.suspended && <Badge variant="destructive" className="text-[10px]">Suspenso</Badge>}</div></div>
            </div>
          <div className="flex flex-wrap items-center gap-4 sm:ml-auto"><div className="text-xs"><p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Último login</p>{account.last_sign_in_at ? <time className="tabular-nums text-ash" dateTime={account.last_sign_in_at} title={`Timestamp original do Auth: ${account.last_sign_in_at}`}>{exactDate(account.last_sign_in_at)} <span className="text-[10px] text-muted-foreground">BRT</span></time> : <span className="text-muted-foreground">Nenhum login registrado pelo Auth</span>}</div><Button variant="outline" size="sm" disabled={protectedAccount} onClick={() => open(account)} title={protectedAccount ? 'Conta gerenciada somente por super admin' : 'Editar todos os dados da conta'}><Pencil className="mr-1.5 h-3.5 w-3.5" />Editar conta</Button><Button variant="outline" size="icon" className="h-9 w-9 border-rose-500/30 text-rose-300 hover:bg-rose-500/10 hover:text-rose-200" disabled={protectedAccount || account.user_id===actor?.id} onClick={() => { setDeleteReason(''); setDeleting(account) }} title={account.user_id===actor?.id ? 'Você não pode excluir sua própria conta' : protectedAccount ? 'Conta gerenciada somente por super admin' : 'Excluir conta e acesso'} aria-label={`Excluir conta de ${account.display_name || account.email}`}><Trash2 className="h-3.5 w-3.5" /></Button></div>
          </article>
        })}
        {!loading && filtered.length===0 && !error && <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma conta encontrada.</p>}
      </div>
      <Dialog open={!!editing} onOpenChange={open => { if (!open) close() }}>
        <DialogContent className={`max-h-[92vh] overflow-y-auto sm:max-w-2xl ${compact ? 'gap-3 p-4' : ''}`} data-lenis-prevent>
          <DialogHeader><DialogTitle>Editar conta</DialogTitle><DialogDescription>{editing?.display_name || editing?.email} · Alterações sensíveis ficam registradas na auditoria.</DialogDescription></DialogHeader>
          {form && editing && <form onSubmit={submit} className={compact ? 'space-y-4' : 'space-y-6'}>
            <fieldset disabled={saving} className="space-y-4"><legend className="mb-3 text-xs font-medium uppercase tracking-wider text-electric">Identidade e contato</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="account-name">Nome de exibição</Label><Input id="account-name" value={form.display_name} onChange={e => change('display_name',e.target.value)} required maxLength={120} /></div>
                <div className="space-y-2"><Label htmlFor="account-email">E-mail de acesso</Label><Input id="account-email" type="email" value={form.email} onChange={e => change('email',e.target.value)} required maxLength={254} /></div>
                <div className="space-y-2"><Label htmlFor="account-phone">Telefone</Label><Input id="account-phone" type="tel" placeholder="+5511999999999" pattern="\+[1-9][0-9]{7,14}" value={form.phone} onChange={e => change('phone',e.target.value)} /><p className="text-[10px] text-muted-foreground">Código internacional, sem espaços. Pode ficar vazio.</p></div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Foto do membro</Label>
                  <div className="flex flex-wrap items-center gap-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                    <Avatar className="h-16 w-16 rounded-xl">
                      <AvatarImage src={avatarPreview || (!avatarRemoved ? form.avatar_url : '')} alt={`Foto de ${form.display_name}`} />
                      <AvatarFallback className="rounded-xl bg-electric-violet/15 text-lg text-violet-200">{(form.display_name || form.email || '?').slice(0,2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => avatarInput.current?.click()}>
                          <ImagePlus className="mr-2 h-4 w-4" />Selecionar da galeria
                        </Button>
                        {(form.avatar_url || avatarFile) && !avatarRemoved && <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => { setAvatarFile(null); setAvatarRemoved(true) }}><X className="mr-2 h-4 w-4" />Remover foto</Button>}
                      </div>
                      <Input ref={avatarInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={selectAvatar} className="hidden" aria-label="Selecionar foto do membro na galeria" />
                      <p className="text-[10px] text-muted-foreground">PNG, JPG ou WEBP, com no máximo 2 MB.{avatarFile ? ` Selecionada: ${avatarFile.name}` : ''}</p>
                    </div>
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Ao trocar o e-mail, o novo endereço passa a ser o login. Confira-o com o usuário antes de salvar.</p>
            </fieldset>
            <fieldset disabled={saving} className="space-y-4 border-t border-border pt-4"><legend className="px-1 text-xs font-medium uppercase tracking-wider text-electric">Permissões e comissão</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{(Object.keys(ROLE_LABELS) as UserRole[]).filter(role => hasRole('super_admin') || (role!=='super_admin' && role!=='executive')).map(role => <label key={role} className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/[0.07] p-3 text-xs"><Checkbox checked={form.roles.includes(role)} onCheckedChange={checked => change('roles',checked ? [...form.roles,role] : form.roles.filter(r => r!==role))} />{ROLE_LABELS[role]}</label>)}</div>
              <div className="grid items-start gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="account-commission">Comissão (%)</Label><Input id="account-commission" type="number" min="0" max="100" step="0.01" required value={form.commission_rate} onChange={e => change('commission_rate',e.target.value)} /><p className="text-[10px] text-muted-foreground">Vale para aprovações futuras. Comissões já aprovadas mantêm o valor registrado.</p></div><div className="space-y-4 pt-1"><label className="flex items-center justify-between gap-3 text-xs"><span>Acesso ao CRM</span><Switch checked={form.crm_access} onCheckedChange={value => change('crm_access',value)} /></label><label className="flex items-center justify-between gap-3 text-xs"><span>Permissão de visualizar vendas</span><Switch checked={form.can_view_sales} onCheckedChange={value => change('can_view_sales',value)} /></label><label className="flex items-center justify-between gap-3 text-xs text-rose-300"><span>Suspender acesso</span><Switch checked={form.suspended} disabled={editing.user_id===actor?.id} onCheckedChange={value => change('suspended',value)} /></label></div></div>
              <p className="text-[10px] text-muted-foreground">Sellers sem função específica acessam SDR e Closer. Funções SDR/Closer definem a área operacional. A opção Acesso ao CRM concede exceções a outros cargos; não revoga o acesso inerente aos cargos comerciais. Para bloquear uma conta, use Suspender acesso.</p>
            </fieldset>
            <fieldset disabled={saving} className="space-y-4 border-t border-border pt-4"><legend className="flex items-center gap-1.5 px-1 text-xs font-medium uppercase tracking-wider text-electric"><KeyRound className="h-3.5 w-3.5" /> Segurança</legend>
              <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="account-password">Nova senha (opcional)</Label><Input id="account-password" type="password" autoComplete="new-password" minLength={7} maxLength={128} value={form.password} onChange={e => change('password',e.target.value)} placeholder="Mínimo 7 caracteres" /><p className="text-[10px] text-muted-foreground">Inclua uma letra maiúscula e um caractere especial.</p></div><div className="space-y-2"><Label htmlFor="account-confirm">Confirmar nova senha</Label><Input id="account-confirm" type="password" autoComplete="new-password" required={!!form.password} value={form.confirm_password} onChange={e => change('confirm_password',e.target.value)} /></div></div>
              <p className="text-[10px] text-muted-foreground">Deixe vazio para manter a senha. Senhas existentes nunca são exibidas.</p>
            </fieldset>
            <div className="rounded-lg bg-white/[0.025] p-3 text-[11px] leading-relaxed text-muted-foreground"><p>Criada em: {exactDate(editing.created_at)} · Brasília</p><p>Último login oficial: {editing.last_sign_in_at ? exactDate(editing.last_sign_in_at) : 'Nenhum registro'} · Brasília</p>{editing.last_sign_in_at && <p className="mt-1 break-all font-mono">UTC original: {editing.last_sign_in_at}</p>}<p className="mt-2">Identificador e horários históricos são registros do servidor, não campos editáveis.</p></div>
            <div className="space-y-2"><Label htmlFor="account-reason">Motivo da alteração</Label><Textarea id="account-reason" required minLength={5} maxLength={2000} value={form.reason} disabled={saving} onChange={e => change('reason',e.target.value)} placeholder="Explique por que esta conta está sendo alterada" /></div>
            <DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={close}>Cancelar</Button><Button type="submit" disabled={saving || !form.roles.length || form.reason.trim().length<5} className="bg-gradient-ember">{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}Salvar conta e registrar</Button></DialogFooter>
          </form>}
        </DialogContent>
      </Dialog>
      <Dialog open={!!deleting} onOpenChange={open => { if (!open) closeDelete() }}>
        <DialogContent className="sm:max-w-md" data-lenis-prevent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-300"><AlertTriangle className="h-4 w-4" />Excluir conta e acesso</DialogTitle>
            <DialogDescription>{deleting?.display_name || deleting?.email}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="rounded-lg bg-rose-500/10 p-3 text-xs leading-relaxed text-rose-200">Esta ação encerra o acesso e remove a conta da lista de usuários. Não pode ser desfeita. Vendas, abordagens, saques e seus vínculos históricos permanecem registrados.</p>
            <div className="space-y-2"><Label htmlFor="delete-reason">Motivo da exclusão</Label><Textarea id="delete-reason" required minLength={5} maxLength={2000} value={deleteReason} disabled={deleteBusy} onChange={e => setDeleteReason(e.target.value)} placeholder="Explique por que esta conta está sendo excluída" /></div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={deleteBusy} onClick={closeDelete}>Cancelar</Button>
            <Button type="button" variant="destructive" disabled={deleteBusy || deleteReason.trim().length<5} onClick={confirmDelete}>{deleteBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}Excluir conta</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
