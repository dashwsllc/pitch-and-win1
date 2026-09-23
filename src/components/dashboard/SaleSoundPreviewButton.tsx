import { Banknote, Bell } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { previewSaleBell } from '@/lib/arena-sound'

export function SaleSoundPreviewButton({ labeled = false }: { labeled?: boolean }) {
  return (
    <Button
      type="button"
      variant="outline"
      size={labeled ? 'default' : 'icon'}
      className={labeled ? 'h-10 rounded-lg px-3' : 'h-10 w-10 rounded-lg'}
      title="Tocar sino de venda"
      aria-label="Tocar sino de venda"
      onClick={() => void previewSaleBell().catch(() => toast.error('Não foi possível reproduzir o som de venda.'))}
    >
      {labeled ? <Banknote aria-hidden="true" className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
      {labeled && <span>Som</span>}
    </Button>
  )
}
