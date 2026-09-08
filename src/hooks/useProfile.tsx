import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { toast } from 'sonner'

const allowedAvatarTypes = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
])

async function hasValidImageSignature(file: File): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  if (file.type === 'image/png') return bytes.slice(0, 8).every((byte, index) => byte === [137, 80, 78, 71, 13, 10, 26, 10][index])
  if (file.type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (file.type === 'image/webp') {
    return String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  }
  return false
}

export function useProfile() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const key = ['profile', user?.id]
  const query = useQuery({
    queryKey: key,
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles')
        .select('id,user_id,display_name,avatar_url,created_at,updated_at,suspended,last_seen_at')
        .eq('user_id', user!.id).single()
      if (error) throw error
      return data
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
  })
  const updateProfile = async (updates: { display_name?: string; avatar_url?: string }) => {
    if (!user) return
    const { data, error } = await supabase.from('profiles').update(updates).eq('user_id', user.id)
      .select('id,user_id,display_name,avatar_url,created_at,updated_at,suspended,last_seen_at').single()
    if (error) { toast.error('Erro ao atualizar perfil'); throw error }
    queryClient.setQueryData(key, data)
    toast.success('Perfil atualizado com sucesso!')
    return data
  }
  const uploadAvatar = async (file: File) => {
    if (!user) return
    const ext = allowedAvatarTypes.get(file.type)
    if (!ext || file.size < 1 || file.size > 2 * 1024 * 1024 || !(await hasValidImageSignature(file))) {
      throw new Error('Use uma imagem PNG, JPG ou WEBP válida de até 2 MB.')
    }
    const filePath = `${user.id}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from('avatars').upload(filePath, file, {
      upsert: false,
      contentType: file.type,
      cacheControl: '3600',
    })
    if (error) { toast.error('Erro ao enviar imagem'); throw error }
    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(filePath)
    await updateProfile({ avatar_url: publicUrl })
    return publicUrl
  }
  return { profile: user ? query.data ?? null : null, loading: !!user && query.isPending,
    error: query.error, refetch: query.refetch, updateProfile, uploadAvatar }
}
