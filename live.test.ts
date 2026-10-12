import { describe, expect, test } from "bun:test"
import { formatLiveTokenSpeed, getLiveTokenSpeed, MAX_LIVE_TEXT_LENGTH } from "./live"
import type { MessageSnapshot, PartSnapshot } from "./metrics"

const open = (over: Partial<MessageSnapshot> = {}): MessageSnapshot => ({
  id: "a1", sessionID: "ses", role: "assistant", time: { created: 1_000 }, modelID: "gpt-4o", ...over,
})

const streaming = (text: string, over: Partial<PartSnapshot> = {}): PartSnapshot => ({
  sessionID: "ses", messageID: "a1", type: "text", text, time: { start: 1_000 }, ...over,
})

const count = (text: string) => text.length

describe("getLiveTokenSpeed", () => {
  test("estima la velocidad con un texto en streaming", () => {
    const value = getLiveTokenSpeed(open(), [streaming("hola mundo")], 3_000, count, "busy")
    expect(value).toEqual({ estimatedTokens: 10, durationMs: 2_000, tokensPerSecond: 5 })
  })

  test("exige que la sesión esté ocupada generando", () => {
    expect(getLiveTokenSpeed(open(), [streaming("texto")], 3_000, count, "idle")).toBeNull()
  })

  test("no estima con el mensaje ya completado", () => {
    const message = open({ time: { created: 1_000, completed: 3_000 } })
    expect(getLiveTokenSpeed(message, [streaming("texto")], 3_000, count, "busy")).toBeNull()
  })

  test("no estima si hay texto cerrado pero ninguno en streaming", () => {
    const part = streaming("texto", { time: { start: 1_000, end: 2_000 } })
    expect(getLiveTokenSpeed(open(), [part], 3_000, count, "busy")).toBeNull()
  })

  test("no estima mientras corre una herramienta", () => {
    const parts = [streaming("texto"), { sessionID: "ses", messageID: "a1", type: "tool", state: { status: "running" } }]
    expect(getLiveTokenSpeed(open(), parts, 3_000, count, "busy")).toBeNull()
  })

  test("espera un mínimo de 500 ms antes de mostrar nada", () => {
    expect(getLiveTokenSpeed(open(), [streaming("texto")], 1_400, count, "busy")).toBeNull()
    expect(getLiveTokenSpeed(open(), [streaming("texto")], 1_600, count, "busy")).not.toBeNull()
  })

  test("descarta el texto sintético, el ignorado y el vacío", () => {
    const parts = [streaming("texto", { synthetic: true }), streaming("texto", { ignored: true }), streaming("")]
    expect(getLiveTokenSpeed(open(), parts, 3_000, count, "busy")).toBeNull()
  })

  test("descarta un bloque de texto mayor que el tope", () => {
    const enorme = "x".repeat(250_001)
    expect(getLiveTokenSpeed(open(), [streaming(enorme)], 3_000, count, "busy")).toBeNull()
  })

  test("descarta una palabra suelta anormalmente larga", () => {
    const largo = "palabra " + "a".repeat(1_100)
    expect(getLiveTokenSpeed(open(), [streaming(largo)], 3_000, count, "busy")).toBeNull()
  })

  test("descarta un intervalo que empieza antes del mensaje", () => {
    const part = streaming("texto", { time: { start: 500 } })
    expect(getLiveTokenSpeed(open(), [part], 3_000, count, "busy")).toBeNull()
  })

  test("descarta un reloj que no avanza respecto a la creación", () => {
    expect(getLiveTokenSpeed(open(), [streaming("texto")], 1_000, count, "busy")).toBeNull()
  })

  test("devuelve null si el tokenizador lanza", () => {
    const lanza = () => { throw new Error("fallo") }
    expect(getLiveTokenSpeed(open(), [streaming("texto")], 3_000, lanza, "busy")).toBeNull()
  })

  test("devuelve null si el tokenizador devuelve algo que no es un entero", () => {
    expect(getLiveTokenSpeed(open(), [streaming("texto")], 3_000, () => 1.5, "busy")).toBeNull()
  })

  test("los intervalos solapados no se suman dos veces", () => {
    const parts = [
      streaming("uno", { time: { start: 1_000, end: 2_000 } }),
      streaming("dos", { time: { start: 1_500 } }),
    ]
    const value = getLiveTokenSpeed(open(), parts, 3_000, () => 10, "busy")
    expect(value?.durationMs).toBe(2_000)
    expect(value?.estimatedTokens).toBe(20)
  })

  test("no mezcla partes de otro mensaje", () => {
    const parts = [streaming("texto", { messageID: "otro" })]
    expect(getLiveTokenSpeed(open(), parts, 3_000, count, "busy")).toBeNull()
  })

  test("sin mensaje no hay estimación", () => {
    expect(getLiveTokenSpeed(undefined, [streaming("texto")], 3_000, count, "busy")).toBeNull()
  })

  test("ignora el error del mensaje", () => {
    const message = open({ error: new Error("boom") })
    expect(getLiveTokenSpeed(message, [streaming("texto")], 3_000, count, "busy")).toBeNull()
  })

  test("ignora los resúmenes", () => {
    const message = open({ summary: {} })
    expect(getLiveTokenSpeed(message, [streaming("texto")], 3_000, count, "busy")).toBeNull()
  })

  test("pasa el modelo al tokenizador para elegir la codificación", () => {
    let recibido: string | undefined
    getLiveTokenSpeed(open({ modelID: "openai/gpt-4" }), [streaming("texto")], 3_000, (_t, model) => {
      recibido = model
      return 1
    }, "busy")
    expect(recibido).toBe("openai/gpt-4")
  })
})

describe("formatLiveTokenSpeed", () => {
  test("marca la estimación como en vivo", () => {
    expect(formatLiveTokenSpeed({ estimatedTokens: 10, durationMs: 1_000, tokensPerSecond: 12.34 }))
      .toBe("≈12,3 tk/s · en vivo")
  })
})

test("el tope de texto total está acotado", () => {
  expect(MAX_LIVE_TEXT_LENGTH).toBe(256_000)
})