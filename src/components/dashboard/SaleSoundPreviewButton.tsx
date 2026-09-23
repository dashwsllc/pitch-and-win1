import { Bell } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { previewSaleBell } from '@/lib/arena-sound'

export function SaleSoundPreviewButton() {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="h-10 w-10 rounded-lg"
      title="Tocar sino de venda"
      aria-label="Tocar sino de venda"
      onClick={() => void previewSaleBell().catch(() => toast.error('Não foi possível reproduzir o som de venda.'))}
    >
      <Bell className="h-4 w-4" />
    </Button>
  )
}
