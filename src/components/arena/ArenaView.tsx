import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDownRight,
  ArrowUpRight,
  ArrowLeft,
  CalendarDays,
  Maximize,
  Minimize,
  RefreshCw,
  Target,
  Trophy,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";


import {
  type DashboardDateFilter,
} from "@/lib/dashboard-period";
import {
  countdown,
  cycleState,
  eventLabels,
  metricDelta,
  milestone,
  progressPercent,
  stateLabels,
  type ArenaCycle,
  type ArenaEvent,
  type ArenaPerson,
  type ArenaDashboard,
} from "@/lib/arena";
import { exactDate, money, errorMessage } from "@/lib/sales";
import { SaleSoundPreviewButton } from "@/components/dashboard/SaleSoundPreviewButton";
import { PersonGoalProgress } from "@/components/arena/PersonGoalProgress";
import "@/components/arena/arena.css";

const number = (n: number) =>
  n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const PACE_UPDATE_MS = 5 * 60 * 1000;
function PersonAvatar({ name, url }: { name: string; url?: string | null }) {
  return (
    <Avatar className="h-9 w-9 shrink-0">
      <AvatarImage src={url || undefined} alt="" />
      <AvatarFallback className="bg-white/5 text-xs">
        {(name || "?")
          .split(" ")
          .map((n) => n[0])
          .slice(0, 2)
          .join("")}
      </AvatarFallback>
    </Avatar>
  );
}
function GoalBar({ cycle, now }: { cycle: ArenaCycle; now: number }) {
  const { actual, target } = cycle.result;
  const isRevenue = cycle.metric === "revenue";
  const state = cycleState(actual, target, cycle.starts_at, cycle.ends_at, now);
  const belowPace = state === "at_risk" || state === "below" || state === "failed";
  const percent = progressPercent(actual, target);
  const previous = useRef<{ id: string; level: number }>();
  const [effect, setEffect] = useState(0);
  const level = milestone(percent);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (previous.current?.id === cycle.id && level > previous.current.level) {
      setEffect(level);
      timer = setTimeout(() => setEffect(0), 2200);
    }
    previous.current = { id: cycle.id, level };
    return () => clearTimeout(timer);
  }, [cycle.id, cycle.title, level]);
  const format = isRevenue
    ? money
    : (value: number) => target > 0 ? `${number(progressPercent(value, target))}%` : "—";
  const startsAt = Date.parse(cycle.starts_at);
  const endsAt = Date.parse(cycle.ends_at);
  const paceNow =
    now >= endsAt
      ? now
      : Math.max(startsAt, Math.floor(now / PACE_UPDATE_MS) * PACE_UPDATE_MS);
  const elapsed = Math.min(
    1,
    Math.max(
      0,
      (paceNow - startsAt) / (endsAt - startsAt),
    ),
  );
  const needed = Math.max(0, target - actual);
  const remainingHours = Math.max(
    0,
    (endsAt - paceNow) / 3600000,
  );
  const remainingUnits =
    cycle.period === "daily" ? remainingHours : remainingHours / 24;
  const projection = elapsed > 0 ? actual / elapsed : null;
  return (
    <article className={`arena-panel arena-goal arena-milestone-${effect}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">
          {cycle.title}
          {cycle.scope === "user" && cycle.result.members[0] && ` · ${cycle.result.members[0].display_name}`}
        </h2>
        <span
          className={
            belowPace
              ? "text-rose-300"
              : "text-emerald-300"
          }
        >
          {stateLabels[state]}
        </span>
      </div>
      <div className="my-2 flex items-baseline justify-between gap-3">
        <p className="text-2xl font-medium tabular-nums">
          {format(actual)}{" "}
          <span className="text-xs font-normal text-muted-foreground">
            {target > 0 ? `/ ${format(target)}` : "sem participantes"}
          </span>
        </p>
        {isRevenue && (
          <strong className="text-xl text-ember tabular-nums">
            {number(percent)}%
          </strong>
        )}
      </div>
      <Progress value={Math.min(100, Math.max(0, percent))} className="h-2" indicatorClassName={belowPace ? "bg-rose-500" : undefined} aria-label={`${number(percent)}% da meta${belowPace ? ", abaixo do ritmo" : ""}`} />
      <div className="mt-2 flex flex-wrap justify-between gap-1 text-xs text-muted-foreground">
        <span>
          {target > 0
            ? `Faltam ${format(needed)} · ritmo ${number(elapsed * 100)}% do ciclo`
            : "Sem participantes neste ciclo"}
        </span>
        {cycle.show_countdown && (
          <time className="tabular-nums">{countdown(cycle.ends_at, now)}</time>
        )}
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        {target <= 0
          ? ""
          : remainingUnits > 0
            ? `${format(needed / remainingUnits)}/${cycle.period === "daily" ? "hora" : "dia"} necessários`
            : "Prazo encerrado"}
        {target > 0 && projection != null && ` · projeção linear ${format(projection)}`}
      </p>
    </article>
  );
}
function RankingList({
  title,
  people,
  cycle,
  linkLabel = "Ver ranking",
}: {
  title: string;
  people: ArenaPerson[];
  cycle?: ArenaCycle;
  linkLabel?: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const rows = Array.from(
      list.current?.querySelectorAll<HTMLElement>("[data-person]") ?? [],
    );
    const animations: Animation[] = [];
    const nextPositions = new Map<string, number>();
    for (const row of rows) {
      const id = row.dataset.person!;
      const top = row.getBoundingClientRect().top;
      const old = positions.current.get(id);
      if (
        old != null &&
        old !== top &&
        !matchMedia("(prefers-reduced-motion: reduce)").matches
      )
        animations.push(
          row.animate(
            [
              { transform: `translateY(${old - top}px)` },
              { transform: "translateY(0)" },
            ],
            { duration: 450, easing: "ease-out" },
          ),
        );
      nextPositions.set(id, top);
    }
    positions.current = nextPositions;
    return () => animations.forEach((a) => a.cancel());
  }, [people]);
  return (
    <section className="arena-panel min-h-0 min-w-0">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-medium">
          <Trophy className="h-4 w-4 text-ember" />
          {title}
        </h2>
        <Link className="text-xs text-muted-foreground" to="/ranking">
          {linkLabel} ↗
        </Link>
      </div>
      <div ref={list} className="space-y-2">
        {people.slice(0, 4).map((person, i) => {
          const member = cycle?.result.members.find(
            (m) => m.user_id === person.user_id,
          );
          return (
            <div
              key={person.user_id}
              data-person={person.user_id}
              className="arena-person rounded-xl px-3 py-2.5"
            >
              <div className="flex items-center gap-3">
                <span
                  className={`w-4 text-sm tabular-nums ${i === 0 ? "text-ember" : "text-muted-foreground"}`}
                >
                  {i + 1}
                </span>
                <PersonAvatar name={person.name} url={person.avatarUrl} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    {person.name}
                    {person.suspended && (
                      <span className="ml-2 text-[10px] text-muted-foreground">
                        inativo
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground" title={person.repasses != null ? `${person.no_handoff ?? 0} sem avanço · ${person.cancelled ?? 0} cancelamentos` : undefined}>
                    {person.repasses != null
                      ? `Q ${person.scheduled} · realizadas ${person.performed} · repasses ${person.repasses} · sem avanço ${person.no_handoff ?? 0} · canc. ${person.cancelled ?? 0}`
                      : `${person.quantidadeVendas} vendas · ${money(person.totalVendas ?? 0)}`}
                  </p>
                </div>
              </div>
              <PersonGoalProgress name={person.name} member={member} period={cycle?.period} />
            </div>
          );
        })}
        {!people.length && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhum participante neste período.
          </p>
        )}
      </div>
    </section>
  );
}
function Feed({ role, events, cycle }: { role: string; events: ArenaEvent[]; cycle?: ArenaCycle }) {
  const rows = events.filter((e) => e.responsible_role === role).slice(0, 3);
  return (
    <section className="arena-panel">
      <h2 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
        {role === "sdr" ? "SDRs" : "Closers"} · últimos movimentos
      </h2>
      {rows.map((event) => {
        const member = cycle?.result.members.find((m) => m.user_id === event.responsible_id);
        const creditedAt = Date.parse(event.cycle_at ?? event.occurred_at);
        const inCycle = cycle && creditedAt >= Date.parse(cycle.starts_at) && creditedAt < Date.parse(cycle.ends_at);
        const impact = member && inCycle && event.score_delta !== 0
          ? progressPercent(event.score_delta, member.target)
          : null;
        return <div key={event.id} className="arena-feed-item flex items-center gap-3 py-1.5">
          <PersonAvatar name={event.responsible_name} url={event.avatar_url} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{event.responsible_name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {eventLabels[event.action_type] || event.action_type}
            </p>
          </div>
          {impact !== null && (
            <span className={`text-right text-sm tabular-nums ${impact < 0 ? "text-rose-300" : "text-emerald-300"}`}>
              {impact > 0 ? "+" : ""}{number(impact)}%
              <small className="block text-[10px] text-muted-foreground">da meta</small>
            </span>
          )}
        </div>;
      })}
      {!rows.length && (
        <p className="py-3 text-xs text-muted-foreground">
          Nenhum evento no ciclo atual.
        </p>
      )}
    </section>
  );
}
export function ArenaView({ query, today, filter, setFilter, custom, setCustom, invalid, toolbar }: {
  query: { data?: ArenaDashboard; checkedAt: number; connected: boolean; isFetching: boolean; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  today: string;
  filter: DashboardDateFilter;
  setFilter: (filter: DashboardDateFilter) => void;
  custom: { start: string; end: string };
  setCustom: React.Dispatch<React.SetStateAction<{ start: string; end: string }>>;
  invalid: string | null;
  toolbar?: React.ReactNode;
}) {
  const [chart, setChart] = useState<"revenue" | "sales" | "appointments">(
    "revenue",
  );
  const [full, setFull] = useState(false);
  const [now, setNow] = useState(Date.now());
  const serverOffset = useRef(0);
  const data = query.data;
  useEffect(() => {
    if (data) serverOffset.current = Date.parse(data.server_time) - Date.now();
  }, [data]);
  useEffect(() => {
    const timer = setInterval(
      () => setNow(Date.now() + serverOffset.current),
      1000,
    );
    const changed = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", changed);
    return () => {
      clearInterval(timer);
      document.removeEventListener("fullscreenchange", changed);
    };
  }, []);
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      toast.error(
        "O navegador não permitiu tela cheia. Use o botão de tela cheia do navegador.",
      );
    }
  };
  const sdr = data?.cycles.find(
    (c) => c.scope === "role" && c.role === "sdr" && c.period === "daily",
  );
  const closer = data?.cycles.find(
    (c) => c.scope === "role" && c.role === "closer" && c.period === "weekly",
  );
  const collectiveGoals = data?.cycles.filter((c) => c.scope !== "user") ?? [];
  const personalGoals = data?.cycles.filter((c) => c.scope === "user") ?? [];
  const cards = [
    ["revenue", "Faturamento bruto", "money"],
    ["sales", "Vendas aprovadas", "number"],
    ["ticket", "Ticket médio", "money"],
    ["conversion", "Conversão de vendas", "percent"],
    ["cpl", "Custo por lead", "money"],
    ["appointments", "Agendamentos", "number"],
  ] as const;
  return (
    <main className="arena-shell" data-day={today}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            aria-label="Voltar ao dashboard"
            className="text-muted-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-ember/15">
            <Target className="h-5 w-5 text-ember" />
          </div>
          <div>
            <h1 className="text-xl font-medium tracking-tight">
              Arena Comercial
            </h1>
            <p className="text-xs text-muted-foreground">
              Performance em movimento · Brasília
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span
            title={
              query.checkedAt
                ? `Verificado em ${exactDate(new Date(query.checkedAt).toISOString())}`
                : "Conectando"
            }
            className={`mr-2 flex items-center gap-1.5 text-[10px] tracking-widest ${query.connected && data ? "text-emerald-300" : "text-amber-300"}`}
          >
            <i className="h-1.5 w-1.5 rounded-full bg-current" />
            {query.connected && data ? "LIVE" : "RECONECTANDO"}
          </span>
          {toolbar}
          <SaleSoundPreviewButton moneyIcon />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Atualizar Arena"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw
              className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={fullscreen}
            aria-label={full ? "Sair da tela cheia" : "Abrir tela cheia"}
          >
            {full ? (
              <Minimize className="h-4 w-4" />
            ) : (
              <Maximize className="h-4 w-4" />
            )}
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/metas">Metas</Link>
          </Button>
        </div>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Indicadores:</span>
          <div className="arena-tabs">
            {(
              [
                ["hoje", "Hoje"],
                ["7dias", "7 dias"],
                ["30dias", "30 dias"],
                ["custom", "Personalizado"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                aria-pressed={filter === key}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Rankings: SDR hoje · Closer semana
        </p>
      </div>
      {filter === "custom" && (
        <div className="flex flex-wrap items-center gap-2">
          <CalendarDays className="h-4 w-4" />
          <Input
            aria-label="Data inicial"
            type="date"
            className="w-40"
            value={custom.start}
            max={today}
            onChange={(e) =>
              setCustom((c) => ({ ...c, start: e.target.value }))
            }
          />
          <Input
            aria-label="Data final"
            type="date"
            className="w-40"
            value={custom.end}
            max={today}
            onChange={(e) => setCustom((c) => ({ ...c, end: e.target.value }))}
          />
          {invalid && (
            <p role="alert" className="text-sm text-rose-300">
              {invalid}
            </p>
          )}
        </div>
      )}
      {query.isError && (
        <p
          role="alert"
          className="rounded-lg border border-rose-400/20 bg-rose-400/10 p-3 text-sm"
        >
          {errorMessage(query.error)}{" "}
          {data && "Exibindo a última leitura disponível."}
        </p>
      )}
      {!data ? (
        <div className="arena-panel py-20 text-center text-muted-foreground">
          {query.isLoading
            ? "Carregando indicadores reais…"
            : "Não foi possível carregar a Arena."}
        </div>
      ) : (
        <>
          <section
            className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"
            aria-label="Indicadores comerciais"
          >
            {cards.map(([key, label, format]) => {
              const value = data.metrics[key],
                delta = metricDelta(value, data.previous[key]),
                positive =
                  delta != null && (key === "cpl" ? delta <= 0 : delta >= 0);
              return (
                <article className="arena-panel" key={key}>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="my-1.5 text-[clamp(1.2rem,1.6vw,2rem)] font-medium tabular-nums">
                    {value == null
                      ? "—"
                      : format === "money"
                        ? money(value)
                        : `${number(value)}${format === "percent" ? "%" : ""}`}
                  </p>
                  <div
                    className={`flex items-center gap-1 text-xs ${delta == null ? "text-muted-foreground" : positive ? "text-emerald-300" : "text-rose-300"}`}
                  >
                    {delta == null ? (
                      "Sem base comparável"
                    ) : (
                      <>
                        {delta >= 0 ? (
                          <ArrowUpRight className="h-3 w-3" />
                        ) : (
                          <ArrowDownRight className="h-3 w-3" />
                        )}
                        {number(Math.abs(delta))}% vs. anterior
                      </>
                    )}
                  </div>
                  {key === "ticket" && (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Referência {money(data.ticket_reference)}
                    </p>
                  )}
                </article>
              );
            })}
          </section>
          <div className="grid gap-3 lg:grid-cols-[1.15fr_1fr]">
            <section className="arena-panel">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm">Evolução comercial</h2>
                <div className="arena-tabs">
                  {(
                    [
                      ["revenue", "Receita"],
                      ["sales", "Vendas"],
                      ["appointments", "Agendamentos"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      aria-pressed={chart === key}
                      onClick={() => setChart(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="arena-chart h-[180px] 2xl:h-[210px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={data.series}
                    margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient
                        id="arena-fill"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor="#ff8e5d"
                          stopOpacity={0.3}
                        />
                        <stop
                          offset="100%"
                          stopColor="#ff8e5d"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      stroke="rgba(255,255,255,.06)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="at"
                      tickFormatter={(v) =>
                        data.series.length <= 25 && filter === "hoje"
                          ? v.slice(11, 16)
                          : v.slice(5, 10).split("-").reverse().join("/")
                      }
                      tick={{ fill: "#999", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      minTickGap={30}
                    />
                    <YAxis
                      allowDecimals={chart === "revenue"}
                      tick={{ fill: "#999", fontSize: 10 }}
                      width={45}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(n) => (n >= 1000 ? `${n / 1000}k` : n)}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "#17101f",
                        border: "1px solid #ffffff15",
                        borderRadius: 10,
                      }}
                      formatter={(v: number) =>
                        chart === "revenue" ? money(v) : number(v)
                      }
                    />
                    <Area
                      type="monotone"
                      dataKey={chart}
                      stroke="#ff8e5d"
                      fill="url(#arena-fill)"
                      strokeWidth={2}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>
            <div className="grid gap-3 sm:grid-cols-2">
              {collectiveGoals.map((cycle) => (
                <div key={cycle.id} className={cycle.scope === "global" ? "sm:col-span-2" : undefined}>
                  <GoalBar cycle={cycle} now={now} />
                </div>
              ))}
              {personalGoals.map((cycle) => (
                <div className="sm:col-span-2" key={cycle.id}>
                  <GoalBar cycle={cycle} now={now} />
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <RankingList title="SDRs · hoje" people={data.sdrs} cycle={sdr} />
            <RankingList title="Closers · semana" people={data.closers} cycle={closer} linkLabel="Ranking mensal" />
          </div>
          <footer className="grid gap-3 lg:grid-cols-2">
            <Feed role="sdr" events={data.feed} cycle={sdr} />
            <Feed role="closer" events={data.feed} cycle={closer} />
          </footer>
        </>
      )}
    </main>
  );
}
