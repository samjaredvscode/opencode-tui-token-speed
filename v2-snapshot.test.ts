import { describe, expect, test } from "bun:test"
import { getV2ContextUsage, getV2LiveTokenSpeed, getV2SessionSnapshot, type V2Message } from "./v2-snapshot"
import { getMessageTokenSpeed } from "./metrics"

const user: V2Message = { id: "user-1", type: "user", time: { created: 1_000 } }
const assistant: V2Message = {
  id: "assistant-1", type: "assistant", time: { created: 2_000, streamed: 2_500, completed: 4_000 },
  model: { id: "model-1", providerID: "provider-1" },
  tokens: { input: 700, output: 100, reasoning: 50, cache: { read: 100, write: 50 } },
  content: [{ type: "text", text: "Respuesta sintética" }],
}

describe("adaptación del contrato V2", () => {
  test("selecciona assistant por type, sin role, sessionID ni parentID de V1", () => {
    const snapshot = getV2SessionSnapshot("session-1", [user, assistant], "idle")
    expect(snapshot.selected?.id).toBe(assistant.id)
    expect(snapshot.selected?.sessionID).toBe("session-1")
    expect(snapshot.selected?.modelID).toBe("model-1")
    expect(snapshot.parts[0]).toMatchObject({ sessionID: "session-1", messageID: assistant.id, type: "text" })
    expect(snapshot.parts[0]?.time).toBeUndefined()
    expect(snapshot.status).toBe("idle")
  })

  test("ordena una copia y respeta el último prompt, sin atribuirle una respuesta anterior", () => {
    const next: V2Message = { ...user, id: "user-2", time: { created: 5_000 } }
    const messages = [next, assistant, user]
    expect(getV2SessionSnapshot("session-1", messages, "running").selected).toBeUndefined()
    expect(messages.map(message => message.id)).toEqual([next.id, assistant.id, user.id])
  })

  test("permite una sesión hija iniciada con un mensaje synthetic", () => {
    const snapshot = getV2SessionSnapshot("child-1", [{ ...user, type: "synthetic" }, assistant], "idle")
    expect(snapshot.selected?.sessionID).toBe("child-1")
    expect(snapshot.selected?.id).toBe(assistant.id)
  })

  test("no convierte compactaciones ni controles en respuestas", () => {
    const compaction = { ...assistant, id: "compaction-1", type: "compaction", time: { created: 5_000 } }
    const idle = { id: "idle-1", type: "idle", time: { created: 6_000 } }
    const snapshot = getV2SessionSnapshot("session-1", [user, assistant, compaction, idle], "idle")
    expect(snapshot.selected?.id).toBe(assistant.id)
    expect(snapshot.messages).toHaveLength(2)
  })

  test("excluye mensajes revertidos desde el límite, aunque la lista original los conserve", () => {
    const snapshot = getV2SessionSnapshot("session-1", [user, assistant], "idle", assistant.id)
    expect(snapshot.selected).toBeUndefined()
    expect(getV2ContextUsage(snapshot, []).tokens).toBeNull()
  })

  test("lee el modelo por providerID e id, no por el identificador remoto modelID", () => {
    const snapshot = getV2SessionSnapshot("session-1", [user, assistant], "idle")
    expect(getV2ContextUsage(snapshot, [
      { id: "model-1", providerID: "other-provider", limit: { context: 10_000 } },
      { id: "model-1", providerID: "provider-1", limit: { context: 2_000 } },
    ])).toEqual({ tokens: 1_000, limit: 2_000, percent: 50, ratio: 0.5 })
  })

  test("un reporte incompleto y un modelo ausente siguen siendo desconocidos", () => {
    const incomplete = { ...assistant, tokens: { output: 100 } }
    expect(getV2ContextUsage(getV2SessionSnapshot("session-1", [user, incomplete], "idle"), []))
      .toEqual({ tokens: null, limit: null, percent: null, ratio: null })
  })

  test("traduce running, herramientas streaming y reintentos de V2", () => {
    const running = { ...assistant, time: { created: 2_000 }, content: [{ type: "tool", state: { status: "streaming" } }] }
    const snapshot = getV2SessionSnapshot("session-1", [user, running], "running")
    expect(snapshot.status).toBe("busy")
    expect(snapshot.parts[0]?.state?.status).toBe("pending")
    expect(getV2SessionSnapshot("session-1", [user, { ...running, retry: { at: 7_000 } }], "running").status).toBe("retry")
    expect(getV2SessionSnapshot("session-1", [user, running], "unknown").status).toBeUndefined()
  })

  test("conserva los errores y no comparte datos al cambiar de sesión", () => {
    const failed = { ...assistant, error: { message: "Fallo sintético" } }
    expect(getV2SessionSnapshot("session-1", [user, failed], "idle").selected?.error).toEqual(failed.error)
    expect(getV2SessionSnapshot("session-2", [], "idle").messages).toEqual([])
  })

  test("estima en vivo sobre la duración total del mensaje, no inventa tiempos de partes V2", () => {
    const running = { ...assistant, time: { created: 2_000, streamed: 2_500 } }
    const snapshot = getV2SessionSnapshot("session-1", [user, running], "running")
    expect(getV2LiveTokenSpeed(snapshot, 4_000, () => 20))
      .toEqual({ estimatedTokens: 20, durationMs: 2_000, tokensPerSecond: 10 })
    expect(snapshot.parts[0]?.time).toBeUndefined()
  })

  test("no estima en vivo durante herramientas, reintentos, idle ni después de completar", () => {
    const running = { ...assistant, time: { created: 2_000 } }
    const tool = { ...running, content: [{ type: "tool", state: { status: "running" } }, { type: "text", text: "Texto" }] }
    for (const [message, status] of [[tool, "running"], [{ ...running, retry: { at: 5_000 } }, "running"], [running, "idle"], [assistant, "idle"]] as const) {
      expect(getV2LiveTokenSpeed(getV2SessionSnapshot("session-1", [user, message], status), 4_000, () => 20)).toBeNull()
    }
  })

  test("calcula la velocidad final reportada sin atribuir intervalos de texto inexistentes", () => {
    const snapshot = getV2SessionSnapshot("session-1", [user, assistant], "idle")
    expect(getMessageTokenSpeed(snapshot.selected, snapshot.parts, snapshot.status)).toEqual({
      state: "complete", outputTokens: 100, durationMs: 2_000, tokensPerSecond: 50, basis: "total",
    })
  })

  test("muestra herramientas, reintentos y errores según el contrato V2", () => {
    const running = { ...assistant, time: { created: 2_000 }, content: [{ type: "tool", state: { status: "streaming" } }] }
    for (const [message, state] of [[running, "tools"], [{ ...running, retry: { at: 5_000 } }, "retry"], [{ ...running, error: {} }, "error"]] as const) {
      const snapshot = getV2SessionSnapshot("session-1", [user, message], "running")
      expect(getMessageTokenSpeed(snapshot.selected, snapshot.parts, snapshot.status).state).toBe(state)
    }
  })

  test("invalida el contexto anterior al completar una compactación, sin borrar la velocidad", () => {
    const compaction = { id: "compaction-1", type: "compaction", status: "completed", time: { created: 5_000 } }
    const snapshot = getV2SessionSnapshot("session-1", [user, assistant, compaction], "idle")
    expect(getV2ContextUsage(snapshot, []).tokens).toBeNull()
    expect(getMessageTokenSpeed(snapshot.selected, snapshot.parts, snapshot.status).state).toBe("complete")
    const next = { ...assistant, id: "assistant-2", time: { created: 6_000, completed: 7_000 } }
    expect(getV2ContextUsage(getV2SessionSnapshot("session-1", [user, assistant, compaction, next], "idle"), []).tokens).toBe(1_000)
  })

  test("una compactación en curso o fallida no invalida el reporte anterior", () => {
    for (const status of ["running", "failed"]) {
      const compaction = { id: "compaction-1", type: "compaction", status, time: { created: 5_000 } }
      expect(getV2ContextUsage(getV2SessionSnapshot("session-1", [user, assistant, compaction], "idle"), []).tokens).toBe(1_000)
    }
  })

  test("acepta el último reporte aunque output sea cero", () => {
    const next = {
      ...assistant, id: "assistant-2", time: { created: 5_000, completed: 6_000 },
      tokens: { input: 1_800, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    }
    const snapshot = getV2SessionSnapshot("session-1", [user, assistant, next], "idle")
    expect(getV2ContextUsage(snapshot, [{ id: "model-1", providerID: "provider-1", limit: { context: 2_000 } }]))
      .toEqual({ tokens: 1_800, limit: 2_000, percent: 90, ratio: 0.9 })
  })

  test("un reporte nuevo de cero tokens no conserva una ocupación antigua", () => {
    const next = {
      ...assistant, id: "assistant-2", time: { created: 5_000, completed: 6_000 },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    }
    expect(getV2ContextUsage(getV2SessionSnapshot("session-1", [user, assistant, next], "idle"), []).tokens).toBeNull()
  })

  test("un límite de reversión ausente no permite certificar contexto de otra porción del historial", () => {
    expect(getV2ContextUsage(getV2SessionSnapshot("session-1", [user, assistant], "idle", "zz-missing-boundary"), []).tokens).toBeNull()
  })
})
