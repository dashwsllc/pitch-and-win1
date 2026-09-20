import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { toast } from 'sonner'
import { refreshIdentityData } from '@/lib/sync'
import { avatarObjectPath, validateAvatarFile } from '@/lib/avatar'

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
    retry: 1,
  })
  const updateProfile = async (updates: { display_name?: string; avatar_url?: string }) => {
    if (!user) return
    const { data, error } = await supabase.from('profiles').update(updates).eq('user_id', user.id)
      .select('id,user_id,display_name,avatar_url,created_at,updated_at,suspended,last_seen_at').single()
    if (error) { toast.error('Erro ao atualizar perfil'); throw error }
    queryClient.setQueryData(key, data)
    await refreshIdentityData(queryClient)
    toast.success('Perfil atualizado com sucesso!')
    return data
  }
  const uploadAvatar = async (file: File) => {
    if (!user) return
    const ext = await validateAvatarFile(file)
    const filePath = `${user.id}/${crypto.randomUUID()}.${ext}`
    let profileUpdated = false
    try {
      const { error } = await supabase.storage.from('avatars').upload(filePath, file, {
        upsert: false,
        contentType: file.type,
        cacheControl: '3600',
      })
      if (error) { toast.error('Erro ao enviar imagem'); throw error }
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(filePath)
      const previousPath = avatarObjectPath(query.data?.avatar_url, user.id)
      await updateProfile({ avatar_url: publicUrl })
      profileUpdated = true
      if (previousPath && previousPath !== filePath) {
        void supabase.storage.from('avatars').remove([previousPath])
      }
      return publicUrl
    } catch (error) {
      if (!profileUpdated) void supabase.storage.from('avatars').remove([filePath])
      throw error
    }
  }
  return { profile: user ? query.data ?? null : null, loading: !!user && query.isPending,
    error: query.error, refetch: query.refetch, updateProfile, uploadAvatar }
}
