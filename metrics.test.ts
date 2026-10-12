import { describe, expect, test } from "bun:test"
import {
  formatTokenSpeed,
  getTokenSpeed,
  selectTokenSpeedMessage,
  type MessageSnapshot,
  type PartSnapshot,
} from "./metrics"

const user = (over: Partial<MessageSnapshot> = {}): MessageSnapshot => ({
  id: "u1", sessionID: "ses", role: "user", time: { created: 1_000 }, ...over,
})

const assistant = (over: Partial<MessageSnapshot> = {}): MessageSnapshot => ({
  id: "a1", sessionID: "ses", role: "assistant", parentID: "u1", time: { created: 2_000, completed: 3_000 },
  tokens: { output: 100 }, ...over,
})

const textPart = (over: Partial<PartSnapshot> = {}): PartSnapshot => ({
  sessionID: "ses", messageID: "a1", type: "text", text: "hola",
  time: { start: 2_000, end: 3_000 }, ...over,
})

const noParts = () => [] as PartSnapshot[]

describe("selectTokenSpeedMessage", () => {
  test("elige el asistente más reciente hijo del último usuario", () => {
    const messages = [user(), assistant(), assistant({ id: "a2", time: { created: 2_500 } })]
    expect(selectTokenSpeedMessage("ses", messages)?.id).toBe("a2")
  })

  test("ignora los resúmenes y los mensajes sin padre", () => {
    const messages = [
      user(),
      assistant(),
      assistant({ id: "a3", summary: {}, time: { created: 9_000 } }),
      assistant({ id: "a4", parentID: undefined, time: { created: 9_500 } }),
    ]
    expect(selectTokenSpeedMessage("ses", messages)?.id).toBe("a1")
  })

  test("no mezcla sesiones", () => {
    const messages = [user(), assistant({ id: "otro", sessionID: "otra" })]
    expect(selectTokenSpeedMessage("ses", messages)).toBeUndefined()
  })

  test("sin mensaje de usuario no hay selección", () => {
    expect(selectTokenSpeedMessage("ses", [assistant()])).toBeUndefined()
  })

  test("desempata por identificador cuando el tiempo coincide", () => {
    const messages = [user(), assistant({ id: "a1" }), assistant({ id: "a2" })]
    expect(selectTokenSpeedMessage("ses", messages)?.id).toBe("a2")
  })
})

describe("getTokenSpeed", () => {
  test("sin mensaje seleccionable no hay dato", () => {
    expect(getTokenSpeed("ses", [], noParts)).toEqual({ state: "unavailable" })
  })

  test("un mensaje con error se marca interrumpido", () => {
    const messages = [user(), assistant({ error: new Error("boom") })]
    expect(getTokenSpeed("ses", messages, noParts)).toEqual({ state: "error" })
  })

  test("el estado de reintento prevalece sobre la generación", () => {
    const messages = [user(), assistant({ time: { created: 2_000 } })]
    expect(getTokenSpeed("ses", messages, noParts, "retry")).toEqual({ state: "retry" })
  })

  test("sin completion sigue generando", () => {
    const messages = [user(), assistant({ time: { created: 2_000 } })]
    expect(getTokenSpeed("ses", messages, noParts)).toEqual({ state: "generating" })
  })

  test("una herramienta activa cambia el estado a herramientas", () => {
    const messages = [user(), assistant({ time: { created: 2_000 } })]
    const parts = [{ sessionID: "ses", messageID: "a1", type: "tool", state: { status: "running" } }]
    expect(getTokenSpeed("ses", messages, () => parts)).toEqual({ state: "tools" })
  })

  test("una herramienta ya completada no cambia el estado", () => {
    const messages = [user(), assistant({ time: { created: 2_000 } })]
    const parts = [{ sessionID: "ses", messageID: "a1", type: "tool", state: { status: "completed" } }]
    expect(getTokenSpeed("ses", messages, () => parts)).toEqual({ state: "generating" })
  })

  test("calcula tk/s sobre el intervalo de texto visible", () => {
    const messages = [user(), assistant()]
    const speed = getTokenSpeed("ses", messages, () => [textPart()])
    expect(speed).toEqual({
      state: "complete", outputTokens: 100, durationMs: 1_000, tokensPerSecond: 100, basis: "text",
    })
  })

  test("con herramientas la base es el intervalo total y se rotula como tal", () => {
    const messages = [user(), assistant()]
    const parts = [textPart(), { sessionID: "ses", messageID: "a1", type: "tool", state: { status: "completed" } }]
    const speed = getTokenSpeed("ses", messages, () => parts)
    expect(speed).toMatchObject({ basis: "total", durationMs: 1_000 })
  })

  test("los intervalos de texto superpuestos no se suman dos veces", () => {
    const messages = [user(), assistant()]
    const parts = [textPart({ time: { start: 2_000, end: 2_600 } }), textPart({ time: { start: 2_300, end: 3_000 } })]
    const speed = getTokenSpeed("ses", messages, () => parts)
    expect(speed).toMatchObject({ durationMs: 1_000, basis: "text" })
  })

  test("ignora el texto sintético y el descartado", () => {
    const messages = [user(), assistant()]
    const parts = [textPart({ synthetic: true }), textPart({ ignored: true })]
    expect(getTokenSpeed("ses", messages, () => parts)).toMatchObject({ basis: "total" })
  })

  test("un intervalo fuera de los límites del mensaje invalida la base de texto", () => {
    const messages = [user(), assistant()]
    const parts = [textPart({ time: { start: 1_000, end: 3_000 } })]
    expect(getTokenSpeed("ses", messages, () => parts)).toMatchObject({ basis: "total", durationMs: 1_000 })
  })

  test("una salida no positiva no produce velocidad", () => {
    const messages = [user(), assistant({ tokens: { output: 0 } })]
    expect(getTokenSpeed("ses", messages, noParts)).toEqual({ state: "unavailable" })
  })

  test("una duración inválida no produce velocidad", () => {
    const messages = [user(), assistant({ time: { created: 3_000, completed: 2_000 } })]
    expect(getTokenSpeed("ses", messages, noParts)).toEqual({ state: "unavailable" })
  })

  test("descarta partes de otro mensaje", () => {
    const messages = [user(), assistant()]
    const parts = [textPart({ messageID: "ajeno" })]
    expect(getTokenSpeed("ses", messages, () => parts)).toMatchObject({ basis: "total" })
  })
})

describe("formatTokenSpeed", () => {
  const complete = { state: "complete" as const, outputTokens: 1, durationMs: 1, tokensPerSecond: 12.34, basis: "text" as const }

  test("usa coma decimal en el separador", () => {
    expect(formatTokenSpeed(complete)).toBe("≈12,3 tk/s")
  })

  test("la base total se rotula", () => {
    expect(formatTokenSpeed({ ...complete, basis: "total" })).toBe("≈12,3 tk/s total")
  })

  test("cada estado no completo tiene su propio texto", () => {
    expect(formatTokenSpeed({ state: "generating" })).toBe("tk/s · generando…")
    expect(formatTokenSpeed({ state: "tools" })).toBe("tk/s · herramientas…")
    expect(formatTokenSpeed({ state: "retry" })).toBe("tk/s · reintentando…")
    expect(formatTokenSpeed({ state: "error" })).toBe("tk/s · interrumpido")
    expect(formatTokenSpeed({ state: "unavailable" })).toBe("tk/s —")
  })
})