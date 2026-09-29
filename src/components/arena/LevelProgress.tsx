import { Award, Flame, Lock, RefreshCw, Trophy } from "lucide-react"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { LevelRing } from "@/components/dashboard/LevelRing"
import { useLevelProgress } from "@/hooks/useLevel"
import { BRASILIA_TIME_ZONE } from "@/lib/brasilia-time"
import { errorMessage } from "@/lib/sales"
import { cn } from "@/lib/utils"

const shortDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: BRASILIA_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
})

export function LevelProgress() {
  const {
    level,
    xp,
    xpIntoLevel,
    xpForNextLevel,
    xpToNext,
    percent,
    roleLabel,
    series,
    streakDays,
    achievements,
    achievementsUnlockedCount,
    hasData,
    loading,
    refreshing,
    error,
    refetch,
  } = useLevelProgress()

  if (loading) {
    return (
      <Card className="surface-inset-glow rounded-2xl border-0">
        <CardContent className="space-y-4 p-6">
          <div className="h-6 w-48 animate-pulse rounded bg-white/[0.04]" />
          <div className="h-28 animate-pulse rounded-xl bg-white/[0.035]" />
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="surface-inset-glow rounded-2xl border-0">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-6">
          <p role="alert" className="text-sm text-destructive">Não foi possível carregar sua progressão: {errorMessage(error)}</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={refreshing}>
            <RefreshCw className={cn("mr-2 h-4 w-4", refreshing && "animate-spin")} />
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    )
  }

  const chartData = series.map((point) => ({ label: shortDateFormatter.format(new Date(point.at)), xp: point.cumulativeXp }))

  return (
    <Card className="surface-inset-glow overflow-hidden rounded-2xl border-0">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-white/[0.05] px-5 py-4 sm:px-6">
        <div>
          <CardTitle className="text-base font-medium tracking-[-0.015em] text-white">Sua Progressão</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">Nível evolui com suas atividades e metas de {roleLabel}</p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-400/10 text-emerald-400 shadow-[rgba(255,255,255,0.06)_0_0_0_1px_inset]">
          <Award className="h-4 w-4" strokeWidth={1.8} />
        </div>
      </CardHeader>
      <CardContent className="space-y-6 p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <LevelRing percent={percent} size={112} strokeWidth={9} className="mx-auto sm:mx-0">
            <div className="flex flex-col items-center">
              <span className="text-2xl font-semibold tabular-nums text-white">{level}</span>
              <span className="max-w-[76px] truncate text-[10px] uppercase tracking-[0.12em] text-emerald-400">{roleLabel}</span>
            </div>
          </LevelRing>

          <div className="flex-1 space-y-3 text-center sm:text-left">
            <div>
              <p className="text-sm tabular-nums text-white">{xpIntoLevel.toLocaleString("pt-BR")} / {xpForNextLevel.toLocaleString("pt-BR")} XP</p>
              <p className="text-xs text-muted-foreground">Faltam {xpToNext.toLocaleString("pt-BR")} XP para o nível {level + 1}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.035] px-3 py-1.5 text-xs tabular-nums text-muted-foreground">
                {xp.toLocaleString("pt-BR")} XP total
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.035] px-3 py-1.5 text-xs tabular-nums text-muted-foreground">
                <Flame className="h-3.5 w-3.5 text-ember" />
                Sequência ativa · {streakDays} {streakDays === 1 ? "dia" : "dias"}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.035] px-3 py-1.5 text-xs tabular-nums text-muted-foreground">
                <Trophy className="h-3.5 w-3.5 text-emerald-400" />
                Conquistas · {achievementsUnlockedCount} de {achievements.length}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {achievements.map((achievement) => (
            <div
              key={achievement.id}
              title={achievement.description}
              className={cn(
                "flex items-center gap-2 rounded-xl px-3 py-2.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)] transition-colors",
                achievement.unlocked ? "bg-emerald-400/[0.08]" : "bg-white/[0.02]",
              )}
            >
              {achievement.unlocked
                ? <Trophy className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                : <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />}
              <span className={cn("truncate text-xs", achievement.unlocked ? "text-ash" : "text-muted-foreground/70")}>
                {achievement.name}
              </span>
            </div>
          ))}
        </div>

        {!hasData && (
          <p className="rounded-xl bg-white/[0.025] px-4 py-3 text-xs text-muted-foreground">
            Seu nível evolui a partir de vendas, calls e abordagens registradas, e das metas do seu cargo. Ainda não há atividade sua computada nesse critério.
          </p>
        )}

        {chartData.length >= 2 && (
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="xpFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34d399" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.055)" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#878091", fontSize: 11 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "#878091", fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  cursor={{ stroke: "rgba(255,255,255,0.12)", strokeDasharray: "4 4" }}
                  contentStyle={{ backgroundColor: "#171221", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", boxShadow: "0 14px 36px rgba(0,0,0,0.28)", color: "#f7f5fb", fontSize: "12px" }}
                  formatter={(value: number) => [`${value.toLocaleString("pt-BR")} XP`, "XP acumulado"]}
                />
                <Area type="monotone" dataKey="xp" name="XP acumulado" stroke="#34d399" strokeWidth={2.2} fill="url(#xpFill)" dot={false} activeDot={{ r: 4, fill: "#6ee7b7", stroke: "#171221", strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
