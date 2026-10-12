import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { leerConfig, escribirConfig, leerRangoHost } from "./disco"

const temporales: string[] = []

function rutaAux(): string {
  const dir = mkdtempSync(join(tmpdir(), "token-speed-"))
  temporales.push(dir)
  return join(dir, "tui.json")
}

afterEach(() => {
  while (temporales.length > 0) rmSync(temporales.pop()!, { recursive: true, force: true })
})

describe("leerConfig", () => {
  test("devuelve una configuración vacía si el fichero no existe", () => {
    expect(leerConfig(join(rutaAux(), "no-existe.json"))).toEqual({})
  })

  test("lee la configuración existente", () => {
    const ruta = rutaAux()
    writeFileSync(ruta, '{"theme":"system"}')
    expect(leerConfig(ruta)).toEqual({ theme: "system" })
  })

  test("el error de un JSON inválido nombra la ruta real", () => {
    const ruta = rutaAux()
    writeFileSync(ruta, "{roto")
    expect(() => leerConfig(ruta)).toThrow(new RegExp(ruta.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  })
})

describe("leerRangoHost", () => {
  const paquete = (cuerpo: unknown) => {
    const ruta = rutaAux()
    writeFileSync(ruta, JSON.stringify(cuerpo))
    return ruta
  }

  test("devuelve null si no se declara el rango", () => {
    expect(leerRangoHost(paquete({ name: "x" }))).toBeNull()
  })

  test("devuelve null si el paquete no existe", () => {
    expect(leerRangoHost(join(rutaAux(), "ausente.json"))).toBeNull()
  })

  test("devuelve el rango declarado", () => {
    const rango = leerRangoHost(paquete({ opencodeHost: { tested: "1.19.0", min: "1.19.0", max: "1.99.99" } }))
    expect(rango).toEqual({ tested: "1.19.0", min: "1.19.0", max: "1.99.99" })
  })

  test("descarta un rango con versiones no interpretables en vez de avisar con basura", () => {
    expect(leerRangoHost(paquete({ opencodeHost: { tested: "x", min: "1.19.0", max: "1.99.99" } }))).toBeNull()
    expect(leerRangoHost(paquete({ opencodeHost: { tested: "1.19.0", min: "1.19", max: "1.99.99" } }))).toBeNull()
  })

  test("descarta un rango incompleto", () => {
    expect(leerRangoHost(paquete({ opencodeHost: { tested: "1.19.0", min: "1.19.0" } }))).toBeNull()
  })
})

describe("escribirConfig", () => {
  test("crea el fichero con salto de línea final", () => {
    const ruta = rutaAux()
    escribirConfig(ruta, { theme: "system" })
    expect(readFileSync(ruta, "utf-8")).toBe('{\n  "theme": "system"\n}\n')
  })

  test("no toca el disco en modo simulación", () => {
    const ruta = rutaAux()
    const resultado = escribirConfig(ruta, { theme: "system" }, { dryRun: true })
    expect(resultado.escrito).toBe(false)
    expect(existsSync(ruta)).toBe(false)
  })

  test("no reescribe si el contenido ya es idéntico", () => {
    const ruta = rutaAux()
    escribirConfig(ruta, { theme: "system" })
    const resultado = escribirConfig(ruta, { theme: "system" })
    expect(resultado.escrito).toBe(false)
    expect(resultado.cambio).toBe(false)
    expect(existsSync(`${ruta}.bak`)).toBe(false)
  })

  test("no reescribe un fichero equivalente con otro formato", () => {
    const ruta = rutaAux()
    const compacto = '{\n  "plugin": ["./tui.tsx"],\n  "plugin_enabled": {"internal:sidebar-context": false}\n}\n'
    writeFileSync(ruta, compacto)
    const resultado = escribirConfig(ruta, {
      plugin: ["./tui.tsx"],
      plugin_enabled: { "internal:sidebar-context": false },
    })
    expect(resultado).toMatchObject({ cambio: false, escrito: false })
    expect(readFileSync(ruta, "utf-8")).toBe(compacto)
    expect(existsSync(`${ruta}.bak`)).toBe(false)
  })

  test("sí sustituye un fichero ilegible", () => {
    const ruta = rutaAux()
    writeFileSync(ruta, "{roto")
    const resultado = escribirConfig(ruta, { theme: "system" })
    expect(resultado).toMatchObject({ cambio: true, escrito: true })
    expect(readFileSync(ruta, "utf-8")).toContain("system")
  })

  test("guarda copia del contenido anterior antes de sobrescribir", () => {
    const ruta = rutaAux()
    escribirConfig(ruta, { theme: "system" })
    escribirConfig(ruta, { theme: "dracula" })
    expect(readFileSync(`${ruta}.bak`, "utf-8")).toBe('{\n  "theme": "system"\n}\n')
  })

  test("el resultado indica si hubo cambio real", () => {
    const ruta = rutaAux()
    const resultado = escribirConfig(ruta, { theme: "dracula" })
    expect(resultado).toMatchObject({ escrito: true, cambio: true })
    expect(resultado.respaldo).toBe(`${ruta}.bak`)
  })

  test("crea el directorio si la configuración global aún no existe", () => {
    const ruta = join(rutaAux(), "anidado", "tui.json")
    escribirConfig(ruta, { theme: "system" })
    expect(readFileSync(ruta, "utf-8")).toContain("system")
  })
})