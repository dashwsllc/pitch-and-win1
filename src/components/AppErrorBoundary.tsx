import { Component, type ErrorInfo, type ReactNode } from 'react'
import { isChunkLoadError, reloadAfterChunkError } from '@/lib/chunk-recovery'

interface Props { children: ReactNode }
interface State { error: Error | null }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Dashboard render failed', error, info)
    if (isChunkLoadError(error)) reloadAfterChunkError()
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center text-foreground">
        <h1 className="text-xl font-semibold">Não foi possível carregar o dashboard</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          A página pode ter sido atualizada enquanto estava aberta ou a conexão pode ter falhado.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <button className="rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground" onClick={() => window.location.reload()}>
            Recarregar página
          </button>
          <a className="rounded-lg border border-border px-4 py-2" href="/">Voltar ao início</a>
        </div>
      </main>
    )
  }
}
