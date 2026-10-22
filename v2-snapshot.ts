import { getMessageContextUsage, type ContextMessageSnapshot, type ContextUsage } from "./context"
import { getLiveTokenSpeed, type LiveTokenSpeed } from "./live"
import type { MessageSnapshot, PartSnapshot } from "./metrics"

// Proyección estructural del contrato público de OpenCode 2.1.3, sin depender del host.
export type V2Message = {
  id: string
  type: string
  status?: string
  time: { created: number; streamed?: number; completed?: number }
  model?: { id: string; providerID: string }
  tokens?: ContextMessageSnapshot["tokens"]
  content?: readonly { type: string; text?: string; state?: { status: string } }[]
  error?: unknown
  retry?: { at: number }
}

export type V2Model = { id: string; providerID: string; limit?: { context?: number } }
export type V2SessionSnapshot = {
  messages: (MessageSnapshot & ContextMessageSnapshot)[]
  contextMessages: ContextMessageSnapshot[]
  selected: MessageSnapshot | undefined
  parts: PartSnapshot[]
  status: string | undefined
}

export function getV2SessionSnapshot(
  sessionID: string,
  messages: readonly V2Message[],
  status: string | undefined,
  boundary?: string,
): V2SessionSnapshot {
  const ordered = [...messages].sort((left, right) => left.time.created - right.time.created || left.id.localeCompare(right.id))
  const boundaryIndex = boundary === undefined ? -1 : ordered.findIndex(message => message.id === boundary)
  const visible = boundary === undefined ? ordered : boundaryIndex >= 0
    ? ordered.slice(0, boundaryIndex) : ordered.filter(message => message.id < boundary)
  const snapshots: V2SessionSnapshot["messages"] = []
  let contextStart = 0
  for (const message of visible) {
    if (message.type === "compaction" && message.status === "completed") contextStart = snapshots.length
    if (message.type !== "assistant" && message.type !== "user" && message.type !== "synthetic") continue
    snapshots.push({
      id: message.id, sessionID, role: message.type === "assistant" ? "assistant" as const : "user" as const,
      time: message.time, modelID: message.model?.id, providerID: message.model?.providerID,
      tokens: message.tokens, error: message.error,
    })
  }
  const contextMessages = boundary !== undefined && boundaryIndex === -1 ? [] : snapshots.slice(contextStart)
  // V2 no publica parentID de mensajes: seleccionar por la secuencia, no inventar parentesco V1.
  const last = snapshots.at(-1)
  const selected = last?.role === "assistant" ? last : undefined
  const source = selected ? visible.find(message => message.id === selected.id) : undefined
  const parts: PartSnapshot[] = (source?.content ?? []).map(part => ({
    sessionID, messageID: source!.id, type: part.type, text: part.text,
    state: part.state ? { status: part.state.status === "streaming" ? "pending" : part.state.status } : undefined,
  }))
  const mappedStatus = status === "running"
    ? source?.retry && source.time.completed === undefined ? "retry" : "busy"
    : status === "idle" ? "idle" : undefined
  return { messages: snapshots, contextMessages, selected, parts, status: mappedStatus }
}

export function getV2ContextUsage(snapshot: V2SessionSnapshot, models: readonly V2Model[]): ContextUsage {
  // Como el selector nativo V2: último reporte tras compactar y antes de revertir,
  // incluso con output=0. Un reporte incompleto no permite reutilizar uno anterior.
  const last = snapshot.contextMessages.findLast(message => message.role === "assistant" && message.tokens !== undefined)
  const model = models.find(model => model.id === last?.modelID && model.providerID === last.providerID)
  const usage = getMessageContextUsage(last, model?.limit?.context)
  return usage.tokens === 0 ? getMessageContextUsage(undefined) : usage
}

export function getV2LiveTokenSpeed(
  snapshot: V2SessionSnapshot,
  now: number,
  countTokens: (text: string, modelID?: string) => number,
): LiveTokenSpeed | null {
  // Los textos V2 no tienen intervalos propios. Medir desde created y rotular «total».
  // Esta proyección solo sirve a la estimación: no altera los tiempos del reporte final.
  const parts = snapshot.parts.map(part => part.type === "text"
    ? { ...part, time: { start: snapshot.selected?.time.created } } : part)
  return getLiveTokenSpeed(snapshot.selected, parts, now, countTokens, snapshot.status)
}
