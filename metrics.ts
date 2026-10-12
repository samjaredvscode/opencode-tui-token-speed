export type MessageSnapshot = {
  id: string
  sessionID: string
  role: "user" | "assistant"
  parentID?: string
  modelID?: string
  time: { created: number; completed?: number }
  tokens?: { output: number }
  summary?: unknown
  error?: unknown
}

export type PartSnapshot = {
  sessionID: string
  messageID: string
  type: string
  text?: string
  time?: { start?: number; end?: number; created?: number }
  synthetic?: boolean
  ignored?: boolean
  state?: { status: string }
}

export type TokenSpeed =
  | { state: "unavailable" | "generating" | "tools" | "retry" | "error" }
  | {
      state: "complete"
      outputTokens: number
      durationMs: number
      tokensPerSecond: number
      basis: "text" | "total"
    }

function newest(messages: readonly MessageSnapshot[]): MessageSnapshot | undefined {
  if (messages.some((message) => !Number.isFinite(message.time.created) || message.time.created < 0)) {
    return undefined
  }
  return messages.reduce<MessageSnapshot | undefined>((latest, message) => {
    if (!latest || message.time.created > latest.time.created) return message
    if (message.time.created === latest.time.created && message.id > latest.id) return message
    return latest
  }, undefined)
}

function textDuration(parts: readonly PartSnapshot[], start: number, end: number): number | undefined {
  // Los tokens de argumentos no tienen intervalos propios: no atribuirlos al texto visible.
  if (parts.some((part) => part.type === "tool")) return undefined
  const textParts = parts.filter((part) => part.type === "text" && !part.synthetic && !part.ignored)
  if (textParts.length === 0) return undefined
  const intervals: { start: number; end: number }[] = []
  for (const part of textParts) {
    const time = part.time
    if (!time || typeof time.start !== "number" || typeof time.end !== "number" || !Number.isFinite(time.start) || !Number.isFinite(time.end)) {
      return undefined
    }
    if (time.start < start || time.end > end || time.end <= time.start) return undefined
    intervals.push({ start: time.start, end: time.end })
  }
  intervals.sort((left, right) => left.start - right.start)
  let duration = 0
  let lastEnd = start
  for (const interval of intervals) {
    duration += Math.max(0, interval.end - Math.max(lastEnd, interval.start))
    lastEnd = Math.max(lastEnd, interval.end)
  }
  return duration > 0 ? duration : undefined
}

export function selectTokenSpeedMessage(
  sessionID: string,
  messages: readonly MessageSnapshot[],
): MessageSnapshot | undefined {
  const sessionMessages = messages.filter((message) => message.sessionID === sessionID)
  const user = newest(sessionMessages.filter((message) => message.role === "user"))
  if (!user) return undefined
  return newest(sessionMessages.filter((item) =>
    item.role === "assistant" && item.parentID === user.id && !item.summary,
  ))
}

export function getTokenSpeed(
  sessionID: string,
  messages: readonly MessageSnapshot[],
  readParts: (messageID: string) => readonly PartSnapshot[],
  sessionStatus?: string,
): TokenSpeed {
  const message = selectTokenSpeedMessage(sessionID, messages)
  if (!message) return { state: "unavailable" }
  if (message.error !== undefined) return { state: "error" }
  if (sessionStatus === "retry") return { state: "retry" }
  const parts = readParts(message.id).filter((part) =>
    part.sessionID === sessionID && part.messageID === message.id,
  )
  const { created, completed } = message.time
  if (completed === undefined) {
    const activeTool = parts.some((part) =>
      part.type === "tool" && (part.state?.status === "pending" || part.state?.status === "running"),
    )
    return { state: activeTool ? "tools" : "generating" }
  }
  const outputTokens = message.tokens?.output
  if (typeof outputTokens !== "number" || !Number.isSafeInteger(outputTokens) || outputTokens <= 0) {
    return { state: "unavailable" }
  }
  if (!Number.isFinite(created) || !Number.isFinite(completed) || created < 0 || completed <= created) {
    return { state: "unavailable" }
  }
  // En V1 tokens.output ya excluye reasoningTokens; el intervalo de razonamiento no es texto de salida.
  const activeDuration = textDuration(parts, created, completed)
  const durationMs = activeDuration ?? completed - created
  const tokensPerSecond = outputTokens / (durationMs / 1_000)
  if (!Number.isFinite(tokensPerSecond)) return { state: "unavailable" }
  return {
    state: "complete", outputTokens, durationMs, tokensPerSecond,
    basis: activeDuration === undefined ? "total" : "text",
  }
}

export function formatTokenSpeed(value: TokenSpeed): string {
  if (value.state === "complete") {
    const rate = value.tokensPerSecond.toFixed(1).replace(".", ",")
    return `≈${rate} tk/s${value.basis === "total" ? " total" : ""}`
  }
  switch (value.state) {
    case "generating": return "tk/s · generando…"
    case "tools": return "tk/s · herramientas…"
    case "retry": return "tk/s · reintentando…"
    case "error": return "tk/s · interrumpido"
    default: return "tk/s —"
  }
}
