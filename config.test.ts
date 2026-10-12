import { describe, expect, test } from "bun:test"
import {
  NATIVE_CONTEXT,
  PLUGIN_ENTRY,
  findUnknownKeys,
  formatHostWarning,
  isHostSupported,
  mergePluginEnabled,
  mergePluginEntry,
  mismoConfig,
  parseTuiConfig,
  parseVersion,
  removePluginEntry,
  renderTuiConfig,
  restoreNativeContext,
  contarEntradas,
  type HostRange,
} from "./config"

const range: HostRange = { tested: "1.19.0", min: "1.19.0", max: "1.99.99" }

describe("mergePluginEntry", () => {
  test("añade la entrada conservando el resto de la configuración", () => {
    const config = { $schema: "https://opencode.ai/tui.json", theme: "system" }
    const next = mergePluginEntry(config)
    expect(next).toEqual({ ...config, plugin: [PLUGIN_ENTRY] })
  })

  test("no duplica la entrada si ya está presente", () => {
    const config = { plugin: [PLUGIN_ENTRY] }
    const next = mergePluginEntry(config)
    expect(next.plugin).toEqual([PLUGIN_ENTRY])
  })

  test("conserva otras entradas de plugin ya registradas", () => {
    const config = { plugin: ["./otro/tui.tsx"] }
    const next = mergePluginEntry(config)
    expect(next.plugin).toEqual(["./otro/tui.tsx", PLUGIN_ENTRY])
  })

  test("elimina entradas duplicadas preexistentes de la ruta propia", () => {
    const config = { plugin: ["./otro/tui.tsx", PLUGIN_ENTRY, PLUGIN_ENTRY] }
    const next = mergePluginEntry(config)
    expect(next.plugin).toEqual(["./otro/tui.tsx", PLUGIN_ENTRY])
  })

  test("acepta la forma [ruta, opciones] sin perderla", () => {
    const config = { plugin: [["./otro/tui.tsx", { flag: true }]] }
    const next = mergePluginEntry(config)
    expect(next.plugin).toEqual([["./otro/tui.tsx", { flag: true }], PLUGIN_ENTRY])
  })

  test("no muta la configuración de entrada", () => {
    const config = { plugin: ["./otro/tui.tsx"] }
    mergePluginEntry(config)
    expect(config.plugin).toEqual(["./otro/tui.tsx"])
  })

  test("rechaza un campo plugin que no es una lista", () => {
    expect(() => mergePluginEntry({ plugin: "./otro/tui.tsx" })).toThrow(/plugin/i)
  })
})

describe("mergePluginEnabled", () => {
  test("desactiva el contexto nativo del host", () => {
    const next = mergePluginEnabled({})
    expect(next.plugin_enabled).toEqual({ [NATIVE_CONTEXT]: false })
  })

  test("es idempotente", () => {
    const once = mergePluginEnabled({ plugin_enabled: { otro: false } })
    const twice = mergePluginEnabled(once)
    expect(twice.plugin_enabled).toEqual({ otro: false, [NATIVE_CONTEXT]: false })
  })

  test("reactiva un contexto nativo que el plugin hubiera dejado apagado", () => {
    const next = mergePluginEnabled({ plugin_enabled: { [NATIVE_CONTEXT]: true } })
    expect(next.plugin_enabled).toEqual({ [NATIVE_CONTEXT]: false })
  })

  test("rechaza un plugin_enabled que no es un objeto", () => {
    expect(() => mergePluginEnabled({ plugin_enabled: false })).toThrow(/plugin_enabled/i)
  })
})

describe("removePluginEntry / restoreNativeContext", () => {
  test("quita la entrada propia y deja el resto intacto", () => {
    const config = { theme: "system", plugin: ["./otro/tui.tsx", PLUGIN_ENTRY] }
    expect(removePluginEntry(config)).toEqual({ theme: "system", plugin: ["./otro/tui.tsx"] })
  })

  test("elimina la lista plugin cuando queda vacía", () => {
    const next = removePluginEntry({ plugin: [PLUGIN_ENTRY] })
    expect("plugin" in next).toBe(false)
  })

  test("elimina el override del contexto nativo para que vuelva el indicador del host", () => {
    const next = restoreNativeContext({ plugin_enabled: { otro: false, [NATIVE_CONTEXT]: false } })
    expect(next.plugin_enabled).toEqual({ otro: false })
  })

  test("elimina plugin_enabled cuando solo contenía el contexto nativo", () => {
    const next = restoreNativeContext({ plugin_enabled: { [NATIVE_CONTEXT]: false } })
    expect("plugin_enabled" in next).toBe(false)
  })

  test("deja intacto un valor del contexto nativo que no puso este plugin", () => {
    const next = restoreNativeContext({ plugin_enabled: { [NATIVE_CONTEXT]: true } })
    expect(next.plugin_enabled).toEqual({ [NATIVE_CONTEXT]: true })
  })
})

describe("contarEntradas", () => {
  test("cuenta la forma de cadena", () => {
    expect(contarEntradas({ plugin: ["./otro/tui.tsx", PLUGIN_ENTRY] })).toBe(1)
  })

  test("cuenta la forma con opciones sin duplicarla", () => {
    expect(contarEntradas({ plugin: [[PLUGIN_ENTRY, { flag: true }]] })).toBe(1)
  })

  test("cuenta cada aparición, aunque esté repetida", () => {
    expect(contarEntradas({ plugin: [PLUGIN_ENTRY, PLUGIN_ENTRY] })).toBe(2)
  })

  test("devuelve cero si no hay lista de plugins", () => {
    expect(contarEntradas({})).toBe(0)
    expect(contarEntradas({ plugin: "nope" })).toBe(0)
  })

  test("es el mismo criterio que usa la fusión al deduplicar", () => {
    const config = { plugin: [PLUGIN_ENTRY, PLUGIN_ENTRY, "./otro/tui.tsx"] }
    expect(contarEntradas(config)).toBe(2)
    expect(contarEntradas(mergePluginEntry(config))).toBe(1)
  })
})

describe("findUnknownKeys", () => {
  test("acepta las claves que el schema de tui.json admite", () => {
    const config = {
      $schema: "https://opencode.ai/tui.json",
      theme: "system",
      plugin: [PLUGIN_ENTRY],
      plugin_enabled: { [NATIVE_CONTEXT]: false },
      keybinds: {},
      cursor: {},
      mouse: {},
    }
    expect(findUnknownKeys(config)).toEqual([])
  })

  test("detecta una clave que impediría arrancar el host", () => {
    expect(findUnknownKeys({ theme: "system", plugins: [] })).toEqual(["plugins"])
  })

  test("devuelve las claves ordenadas para que el aviso sea estable", () => {
    expect(findUnknownKeys({ zeta: 1, alfa: 2, plugin: [] })).toEqual(["alfa", "zeta"])
  })
})

describe("parseTuiConfig / renderTuiConfig", () => {
  test("interpreta una configuración válida", () => {
    expect(parseTuiConfig('{"theme":"system"}')).toEqual({ theme: "system" })
  })

  test("el error de sintaxis indica el fichero y la causa", () => {
    expect(() => parseTuiConfig("{no es json}", "/cfg/tui.json")).toThrow(/\/cfg\/tui\.json/)
  })

  test("rechaza un JSON que no es un objeto", () => {
    expect(() => parseTuiConfig("[1,2]")).toThrow(/objeto/i)
  })

  test("renderiza con dos espacios y salto final", () => {
    expect(renderTuiConfig({ theme: "system" })).toBe('{\n  "theme": "system"\n}\n')
  })

  test("el ciclo escribir y leer devuelve la misma configuración", () => {
    const config = mergePluginEnabled(mergePluginEntry({ $schema: "https://opencode.ai/tui.json" }))
    expect(parseTuiConfig(renderTuiConfig(config))).toEqual(config)
  })

  test("el orden de las claves no impide considerar la configuración igual", () => {
    expect(mismoConfig({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
  })

  test("el orden de los elementos de una lista sí cuenta", () => {
    expect(mismoConfig({ a: [1, 2] }, { a: [2, 1] })).toBe(false)
  })

  test("distingue listas de objetos y detecta claves de más o de menos", () => {
    expect(mismoConfig({ a: [1] }, { a: { 0: 1 } })).toBe(false)
    expect(mismoConfig({ a: 1, b: 2 }, { a: 1 })).toBe(false)
    expect(mismoConfig({ a: 1 }, { a: 1, b: undefined })).toBe(false)
  })

  test("distingue null de ausente y de valor falsy", () => {
    expect(mismoConfig({ a: null }, { a: null })).toBe(true)
    expect(mismoConfig({ a: null }, {})).toBe(false)
    expect(mismoConfig({ a: 0 }, { a: false })).toBe(false)
  })
})

describe("parseVersion", () => {
  test("acepta una versión con prefijo de v", () => {
    expect(parseVersion("v1.19.0")).toEqual({ major: 1, minor: 19, patch: 0 })
  })

  test("acepta una versión con sufijo de precompilación", () => {
    expect(parseVersion("1.19.3-beta.1")).toEqual({ major: 1, minor: 19, patch: 3 })
  })

  test("devuelve null para una versión no interpretable", () => {
    expect(parseVersion("desconocida")).toBeNull()
    expect(parseVersion("")).toBeNull()
    expect(parseVersion("1.19")).toBeNull()
  })
})

describe("isHostSupported", () => {
  test("acepta la versión dentro del rango, incluidos los extremos", () => {
    expect(isHostSupported(parseVersion("1.19.0")!, range)).toBe(true)
    expect(isHostSupported(parseVersion("1.99.99")!, range)).toBe(true)
  })

  test("rechaza una versión anterior al mínimo", () => {
    expect(isHostSupported(parseVersion("1.18.35")!, range)).toBe(false)
  })

  test("rechaza un salto de major", () => {
    expect(isHostSupported(parseVersion("2.0.0")!, range)).toBe(false)
  })

  test("una versión no interpretable no se considera soportada", () => {
    expect(isHostSupported(parseVersion("no-se")!, range)).toBe(false)
  })
})

describe("formatHostWarning", () => {
  test("nombra la versión detectada, el rango y la consecuencia real", () => {
    const warning = formatHostWarning(parseVersion("2.0.0")!, range)
    expect(warning).toContain("2.0.0")
    expect(warning).toContain("1.19.0")
    expect(warning).toContain("1.99.99")
    expect(warning).toMatch(/probado|verificad/i)
  })
})