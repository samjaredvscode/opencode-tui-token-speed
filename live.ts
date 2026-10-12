import type { MessageSnapshot, PartSnapshot } from "./metrics"

export const MAX_LIVE_PART_LENGTH = 250_000
export const MAX_LIVE_TEXT_LENGTH = 256_000
export const MAX_LIVE_RUN_LENGTH = 1_024
const oversizedRun = /\S{1025}/

export type LiveTokenSpeed = {
  estimatedTokens: number
  durationMs: number
  tokensPerSecond: number
}

export function getLiveTokenSpeed(
  message: MessageSnapshot | undefined,
  parts: readonly PartSnapshot[],
  now: number,
  countTokens: (text: string, modelID?: string) => number,
  sessionStatus: string | undefined,
): LiveTokenSpeed | null {
  if (!message || message.time.completed !== undefined || message.error !== undefined || message.summary || sessionStatus !== "busy") return null
  const created = message.time.created
  if (!Number.isFinite(created) || created < 0 || !Number.isFinite(now) || now <= created) return null
  const ownParts = parts.filter((part) => part.sessionID === message.sessionID && part.messageID === message.id)
  if (ownParts.some((part) => part.type === "tool" && (part.state?.status === "pending" || part.state?.status === "running"))) return null
  const textParts = ownParts.filter((part) => part.type === "text" && !part.synthetic && !part.ignored && typeof part.text === "string" && part.text.length > 0)
  if (!textParts.some((part) => part.time?.end === undefined)) return null
  let length = 0
  const intervals: { start: number; end: number }[] = []
  for (const part of textParts) {
    length += part.text!.length
    if (part.text!.length > MAX_LIVE_PART_LENGTH || length > MAX_LIVE_TEXT_LENGTH || oversizedRun.test(part.text!)) return null
    const start = part.time?.start
    const end = part.time?.end ?? now
    if (typeof start !== "number" || !Number.isFinite(start) || !Number.isFinite(end) || start < created || end > now || end <= start) return null
    intervals.push({ start, end })
  }
  intervals.sort((left, right) => left.start - right.start)
  let durationMs = 0
  let lastEnd = created
  for (const interval of intervals) {
    durationMs += Math.max(0, interval.end - Math.max(lastEnd, interval.start))
    lastEnd = Math.max(lastEnd, interval.end)
  }
  if (durationMs < 500) return null
  let estimatedTokens = 0
  try {
    // Retokenizar texto completo conserva fusiones BPE; un delta de transporte no es un token.
    for (const part of textParts) {
      const count = countTokens(part.text!, message.modelID)
      if (!Number.isSafeInteger(count) || count < 0) return null
      estimatedTokens += count
    }
  } catch {
    return null
  }
  if (!Number.isSafeInteger(estimatedTokens) || estimatedTokens <= 0) return null
  const tokensPerSecond = estimatedTokens / (durationMs / 1_000)
  return Number.isFinite(tokensPerSecond) ? { estimatedTokens, durationMs, tokensPerSecond } : null
}

export function formatLiveTokenSpeed(value: LiveTokenSpeed): string {
  return `≈${value.tokensPerSecond.toFixed(1).replace(".", ",")} tk/s · en vivo`
}
