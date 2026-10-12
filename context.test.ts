import { describe, expect, test } from "bun:test"
import {
  formatCompactTokens,
  formatContextBar,
  formatContextUsage,
  getContextTone,
  getContextUsage,
  type ContextMessageSnapshot,
  type ContextProviderSnapshot,
} from "./context"

const providers: ContextProviderSnapshot[] = [
  { id: "anthropic", models: { "space-bunny-free": { limit: { context: 200_000 } } } },
  { id: "abierto", models: { "modelo-sin-limite": {} } },
]

const assistant = (over: Partial<ContextMessageSnapshot> = {}): ContextMessageSnapshot => ({
  sessionID: "ses",
  role: "assistant",
  providerID: "anthropic",
  modelID: "space-bunny-free",
  tokens: { input: 1_000, output: 200, reasoning: 50, cache: { read: 300, write: 100 } },
  ...over,
})

describe("getContextUsage", () => {
  test("suma input, output, reasoning y caché del último reporte", () => {
    const usage = getContextUsage("ses", [assistant()], providers)
    expect(usage.tokens).toBe(1_650)
    expect(usage.limit).toBe(200_000)
    expect(usage.ratio).toBeCloseTo(0.00825, 5)
    expect(usage.percent).toBe(1)
  })

  test("toma el último reporte positivo, no la suma del historial", () => {
    const completo = { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } }
    const usage = getContextUsage("ses", [assistant(), assistant({ tokens: completo })], providers)
    expect(usage.tokens).toBe(15)
  })

  // Comportamiento vigente, deliberadamente conservador: si falta cualquiera de los
  // cinco componentes el total se declara desconocido en vez de estimarse. Si el host
  // puede omitir `reasoning` o `cache` en algún proveedor, esto deja el contexto en «—».
  test("si falta un componente del reporte el total se declara desconocido", () => {
    const usage = getContextUsage("ses", [assistant({ tokens: { input: 10, output: 5 } })], providers)
    expect(usage.tokens).toBeNull()
    expect(usage.percent).toBeNull()
  })

  test("ignora los mensajes de otra sesión", () => {
    const usage = getContextUsage("otra", [assistant()], providers)
    expect(usage.tokens).toBeNull()
  })

  test("sin sesión indicada devuelve todo desconocido", () => {
    expect(getContextUsage(undefined, [assistant()], providers)).toEqual({
      tokens: null, limit: null, percent: null, ratio: null,
    })
  })

  test("ignora un reporte sin salida positiva", () => {
    const usage = getContextUsage("ses", [assistant({ tokens: { input: 5, output: 0 } })], providers)
    expect(usage.tokens).toBeNull()
  })

  test("sin modelo declarado no hay límite pero sí tokens usados", () => {
    const usage = getContextUsage("ses", [assistant({ modelID: undefined })], providers)
    expect(usage.tokens).toBe(1_650)
    expect(usage.limit).toBeNull()
    expect(usage.percent).toBeNull()
  })

  test("un modelo sin límite de contexto no inventa un porcentaje", () => {
    const usage = getContextUsage(
      "ses",
      [assistant({ providerID: "abierto", modelID: "modelo-sin-limite" })],
      providers,
    )
    expect(usage.limit).toBeNull()
    expect(usage.percent).toBeNull()
    expect(usage.tokens).toBe(1_650)
  })

  test("un componente con recuento no entero invalida el total en vez de estimarlo", () => {
    const usage = getContextUsage(
      "ses",
      [assistant({ tokens: { input: 1_000.5, output: 200 } })],
      providers,
    )
    expect(usage.tokens).toBeNull()
    expect(usage.percent).toBeNull()
  })

  test("un límite cero o negativo no se usa como denominador", () => {
    const usage = getContextUsage(
      "ses",
      [assistant({ providerID: "cero", modelID: "m" })],
      [{ id: "cero", models: { m: { limit: { context: 0 } } } }],
    )
    expect(usage.limit).toBeNull()
    expect(usage.percent).toBeNull()
  })
})

describe("formatCompactTokens", () => {
  test("usa raya cuando no hay dato", () => {
    expect(formatCompactTokens(null)).toBe("—")
  })

  test("deja los valores por debajo de mil sin abreviar", () => {
    expect(formatCompactTokens(0)).toBe("0")
    expect(formatCompactTokens(999)).toBe("999")
  })

  test("abrevia millares con una cifra decimal como máximo", () => {
    expect(formatCompactTokens(1_000)).toBe("1k")
    expect(formatCompactTokens(1_500)).toBe("1,5k")
  })

  test("abrevia millones con dos decimales como máximo", () => {
    expect(formatCompactTokens(1_000_000)).toBe("1M")
  })
})

describe("formatContextBar", () => {
  const usage = (ratio: number | null) => ({ tokens: 1, limit: 10, percent: null, ratio })

  test("con ratio desconocido dibuja la barra vacía de puntos", () => {
    expect(formatContextBar(usage(null), 8)).toBe("[········]")
  })

  test("rellena de forma proporcional", () => {
    expect(formatContextBar(usage(0.5), 8)).toBe("[████░░░░]")
  })

  test("un ratio superior a uno se satura en lugar de desbordar", () => {
    expect(formatContextBar(usage(1.4), 4)).toBe("[████]")
  })

  test("un ratio negativo no genera una barra invertida", () => {
    expect(formatContextBar(usage(-1), 4)).toBe("[░░░░]")
  })

  test("acota el ancho de la barra a un rango utilizable", () => {
    expect(formatContextBar(usage(0.5), 999)).toHaveLength(26)
    expect(formatContextBar(usage(0.5), 0)).toHaveLength(3)
  })
})

describe("formatContextUsage", () => {
  const usage = getContextUsage("ses", [assistant()], providers)

  test("el estilo completo muestra usados y límite", () => {
    expect(formatContextUsage(usage)).toBe("Contexto [░░░░░░░░░░░░░░░░] 1% · 1,7k/200k tk")
  })

  test("el estilo compacto solo añade los usados", () => {
    expect(formatContextUsage(usage, 16, "compact")).toBe("Ctx [░░░░░░░░░░░░░░░░] 1% 1,7k tk")
  })

  test("el estilo cabecera omite los usados", () => {
    expect(formatContextUsage(usage, 16, "header")).toBe("Ctx [░░░░░░░░░░░░░░░░] 1%")
  })

  test("una ocupación alta llena la barra", () => {
    const lleno = getContextUsage(
      "ses",
      [assistant({ tokens: { input: 180_000, output: 5_000, reasoning: 0, cache: { read: 0, write: 0 } } })],
      providers,
    )
    expect(formatContextBar(lleno, 8)).toBe("[███████░]")
    expect(lleno.percent).toBe(93)
  })

  test("sin datos muestra guiones en lugar de ceros", () => {
    const vacio = getContextUsage("nada", [], providers)
    expect(formatContextUsage(vacio)).toContain("—%")
  })
})

describe("getContextTone", () => {
  const at = (percent: number | null) =>
    getContextTone({ tokens: 1, limit: 10, percent, ratio: percent === null ? null : percent / 100 })

  test("sin porcentaje el tono es apagado", () => {
    expect(at(null)).toBe("muted")
  })

  test("normal por debajo del 70", () => {
    expect(at(0)).toBe("normal")
    expect(at(69)).toBe("normal")
  })

  test("aviso entre 70 y 89", () => {
    expect(at(70)).toBe("warning")
    expect(at(89)).toBe("warning")
  })

  test("crítico desde 90", () => {
    expect(at(90)).toBe("critical")
    expect(at(100)).toBe("critical")
  })
})