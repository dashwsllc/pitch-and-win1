import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CalendarDays } from "lucide-react"

interface FilterTabsProps {
  value: string
  onValueChange: (value: string) => void
}

export function FilterTabs({ value, onValueChange }: FilterTabsProps) {
  const filters = [
    { value: "hoje", label: "Hoje" },
    { value: "ontem", label: "Ontem" },
    { value: "7dias", label: "7 dias" },
    { value: "14dias", label: "14 dias" },
    { value: "30dias", label: "30 dias" },
  ]

  return (
    <Tabs value={value} onValueChange={onValueChange} className="w-full">
      <TabsList className="grid h-auto w-full grid-cols-5 gap-1 rounded-xl bg-white/[0.035] p-1 shadow-[rgba(255,255,255,0.07)_0_0_0_1px_inset]">
        {filters.map((filter) => (
          <TabsTrigger 
            key={filter.value}
            value={filter.value}
            className="min-h-9 rounded-lg px-2 text-xs font-medium text-muted-foreground transition-all sm:text-sm data-[state=active]:bg-white/[0.08] data-[state=active]:text-white data-[state=active]:shadow-[rgba(255,142,93,0.25)_0_1px_0_inset]"
          >
            {filter.value === "hoje" && <CalendarDays className="mr-1.5 hidden h-3.5 w-3.5 sm:block" />}
            {filter.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
