export type ContextMessageSnapshot = {
  sessionID: string
  role: "user" | "assistant"
  providerID?: string
  modelID?: string
  tokens?: {
    input?: number
    output: number
    reasoning?: number
    cache?: { read?: number; write?: number }
    total?: number
  }
}

export type ContextProviderSnapshot = {
  id: string
  models: Readonly<Record<string, { limit?: { context?: number } }>>
}

export type ContextUsage = {
  tokens: number | null
  limit: number | null
  percent: number | null
  ratio: number | null
}

const unknownUsage = (): ContextUsage => ({ tokens: null, limit: null, percent: null, ratio: null })
const isTokenCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0

export function getContextUsage(
  sessionID: string | undefined,
  messages: readonly ContextMessageSnapshot[],
  providers: readonly ContextProviderSnapshot[],
): ContextUsage {
  // Misma selección que el contexto nativo de V1: último reporte positivo, no suma del historial.
  const last = messages.findLast((message) =>
    message.sessionID === sessionID && message.role === "assistant" && (message.tokens?.output ?? 0) > 0,
  )
  if (!last?.tokens) return unknownUsage()
  const model = last.modelID === undefined ? undefined
    : providers.find((provider) => provider.id === last.providerID)?.models[last.modelID]
  const context = model?.limit?.context
  const limit = isTokenCount(context) && context > 0 ? context : null
  const values = [last.tokens.input, last.tokens.output, last.tokens.reasoning, last.tokens.cache?.read, last.tokens.cache?.write]
  const total = values.every(isTokenCount) ? values.reduce((sum, value) => sum + value, 0) : null
  const tokens = isTokenCount(total) ? total : null
  const ratio = tokens !== null && limit !== null ? tokens / limit : null
  return { tokens, limit, ratio, percent: ratio === null ? null : Math.round(ratio * 100) }
}

export function formatCompactTokens(tokens: number | null): string {
  if (tokens === null) return "—"
  if (tokens < 1_000) return String(tokens)
  const thousands = Math.round(tokens / 100) / 10
  if (thousands < 1_000) {
    return `${thousands.toLocaleString("es-ES", { maximumFractionDigits: 1 })}k`
  }
  return `${(tokens / 1_000_000).toLocaleString("es-ES", { maximumFractionDigits: 2 })}M`
}

export function formatContextBar(value: ContextUsage, cells = 16): string {
  const length = Number.isFinite(cells) ? Math.max(1, Math.min(24, Math.trunc(cells))) : 16
  const filled = value.ratio === null ? null : Math.round(Math.min(1, Math.max(0, value.ratio)) * length)
  const bar = filled === null ? "·".repeat(length) : "█".repeat(filled) + "░".repeat(length - filled)
  return `[${bar}]`
}

export function formatContextUsage(value: ContextUsage, cells = 16, style: "full" | "compact" | "header" = "full"): string {
  const bar = formatContextBar(value, cells)
  const percent = value.percent ?? "—"
  const header = `Ctx ${bar} ${percent}%`
  if (style === "header") return header
  const used = formatCompactTokens(value.tokens)
  if (style === "compact") return `${header} ${used} tk`
  return `Contexto ${bar} ${percent}% · ${used}/${formatCompactTokens(value.limit)} tk`
}

export function getContextTone(value: ContextUsage): "muted" | "normal" | "warning" | "critical" {
  if (value.percent === null) return "muted"
  if (value.percent >= 90) return "critical"
  if (value.percent >= 70) return "warning"
  return "normal"
}
