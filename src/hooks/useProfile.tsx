import { useState, useEffect } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { toast } from 'sonner'

interface Profile {
  id: string
  user_id: string
  display_name: string | null
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export function useProfile() {
  const { user } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(() => {
    if (typeof window === 'undefined') return null
    if (!user) return null
    try {
      const cached = localStorage.getItem(`profile_${user.id}`)
      return cached ? JSON.parse(cached) as Profile : null
    } catch {
      return null
    }
  })
  const [loading, setLoading] = useState(true)

useEffect(() => {
  if (!user) {
    setProfile(null)
    setLoading(false)
    return
  }

    const fetchProfile = async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('user_id', user.id)
          .single()

        if (error && error.code !== 'PGRST116') {
          throw error
        }

        setProfile(data)
      } catch (error) {
        console.error('Erro ao buscar perfil:', error)
        toast.error('Erro ao carregar perfil')
      } finally {
        setLoading(false)
      }
    }

    fetchProfile()
  }, [user])

  const updateProfile = async (updates: Partial<Profile>) => {
    if (!user) return

    try {
      const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('user_id', user.id)
        .select()
        .single()

      if (error) throw error

      setProfile(data)
      toast.success('Perfil atualizado com sucesso!')
      return data
    } catch (error) {
      console.error('Erro ao atualizar perfil:', error)
      toast.error('Erro ao atualizar perfil')
      throw error
    }
  }

  const uploadAvatar = async (file: File) => {
    if (!user) return

    try {
      const fileExt = file.name.split('.').pop()
      const fileName = `${user.id}.${fileExt}`
      const filePath = `${user.id}/${fileName}`

      // Remove avatar anterior se existir
      if (profile?.avatar_url) {
        const oldPath = profile.avatar_url.split('/').slice(-2).join('/')
        await supabase.storage.from('avatars').remove([oldPath])
      }

      // Upload novo avatar
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, { upsert: true })

      if (uploadError) throw uploadError

      // Obter URL pública
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath)

      // Atualizar perfil com nova URL
      await updateProfile({ avatar_url: publicUrl })

      return publicUrl
    } catch (error) {
      console.error('Erro ao fazer upload do avatar:', error)
      toast.error('Erro ao fazer upload da imagem')
      throw error
    }
  }

  useEffect(() => {
    if (user?.id && profile) {
      try {
        localStorage.setItem(`profile_${user.id}`, JSON.stringify(profile))
      } catch {}
    }
  }, [user?.id, profile])

  return {
    profile,
    loading,
    updateProfile,
    uploadAvatar
  }
}