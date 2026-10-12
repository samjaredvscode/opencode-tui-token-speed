import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseDebugPaths, resolveConfigDir, mismaRuta } from "./entorno"

const aux: string[] = []
afterEach(() => {
  while (aux.length > 0) rmSync(aux.pop()!, { recursive: true, force: true })
})

function dirAux(): string {
  const dir = mkdtempSync(join(tmpdir(), "entorno-"))
  aux.push(dir)
  return dir
}

const salida = `home       /home/ejemplo
data       /home/ejemplo/.local/share/opencode
config     /home/ejemplo/.config/opencode
cache      /home/ejemplo/.cache/opencode
`

const ok = (stdout: string) => () => ({ ok: true, stdout })
const falla = () => () => ({ ok: false, stdout: "", error: "ENOENT" })

describe("parseDebugPaths", () => {
  test("extrae cada clave con su valor", () => {
    expect(parseDebugPaths(salida)).toEqual({
      home: "/home/ejemplo",
      data: "/home/ejemplo/.local/share/opencode",
      config: "/home/ejemplo/.config/opencode",
      cache: "/home/ejemplo/.cache/opencode",
    })
  })

  test("tolera separaciones de ancho variable", () => {
    expect(parseDebugPaths("config /otro/opencode\n")).toEqual({ config: "/otro/opencode" })
  })

  test("ignora líneas sin separación", () => {
    expect(parseDebugPaths("basura\n")).toEqual({})
  })
})

describe("resolveConfigDir", () => {
  test("prefiere la ruta que declara el propio host", () => {
    const dir = resolveConfigDir(ok("config /opt/otro/opencode\n"), { HOME: "/home/x", XDG_CONFIG_HOME: "/home/x/.config" })
    expect(dir).toBe("/opt/otro/opencode")
  })

  test("cae en XDG_CONFIG_HOME si el host no responde", () => {
    const dir = resolveConfigDir(falla(), { HOME: "/home/x", XDG_CONFIG_HOME: "/home/x/xdg" })
    expect(dir).toBe("/home/x/xdg/opencode")
  })

  test("cae en HOME/.config si no hay XDG", () => {
    expect(resolveConfigDir(falla(), { HOME: "/home/x" })).toBe("/home/x/.config/opencode")
  })

  test("no devuelve una ruta vacía aunque el host no diga nada", () => {
    expect(resolveConfigDir(ok(""), { HOME: "/home/x" })).toBe("/home/x/.config/opencode")
  })

  test("lanza si no hay ningún hogar del que deducir la ruta", () => {
    expect(() => resolveConfigDir(falla(), {})).toThrow(/HOME|XDG_CONFIG_HOME/)
  })

  test("no silencia un fallo que no sea la ausencia del host", () => {
    const revienta = () => { throw new Error("permiso denegado") }
    expect(() => resolveConfigDir(revienta, { HOME: "/home/x" })).toThrow(/permiso denegado/)
  })

  test("tolera que el host no exista en el PATH", () => {
    const ausente = () => ({ ok: false, stdout: "", error: "ENOENT" })
    expect(resolveConfigDir(ausente, { HOME: "/home/x" })).toBe("/home/x/.config/opencode")
  })

  test("descarta una ruta relativa impuesta por el host", () => {
    expect(resolveConfigDir(ok("config ../../../escape\n"), { HOME: "/home/x" })).toBe("/home/x/.config/opencode")
  })

  test("resuelve los saltos de directorio en vez de dejarlos sin normalizar", () => {
    expect(resolveConfigDir(ok("config /home/u/.config/opencode/../opencode\n"), { HOME: "/home/x" }))
      .toBe("/home/u/.config/opencode")
  })

  test("descarta la raíz del sistema", () => {
    expect(resolveConfigDir(ok("config /\n"), { HOME: "/home/x" })).toBe("/home/x/.config/opencode")
  })

  test("normaliza una ruta con barra final", () => {
    expect(resolveConfigDir(ok("config /opt/opencode/\n"), { HOME: "/home/x" })).toBe("/opt/opencode")
  })
})
describe("mismaRuta", () => {
  test("reconoce la misma ruta escrita con segmentos redundantes", () => {
    const dir = dirAux()
    expect(mismaRuta(dir, join(dir, "sub", ".."))).toBe(true)
    expect(mismaRuta(dir, `${dir}/`)).toBe(true)
  })

  test("reconoce un enlace simbólico que apunta al mismo sitio", () => {
    const dir = dirAux()
    const real = join(dir, "real")
    mkdirSync(real)
    symlinkSync(real, join(dir, "enlace"))
    expect(mismaRuta(join(dir, "real"), join(dir, "enlace"))).toBe(true)
  })

  test("distingue rutas distintas", () => {
    const dir = dirAux()
    const otro = dirAux()
    expect(mismaRuta(dir, otro)).toBe(false)
  })

  test("no se equivoca cuando el destino todavía no existe", () => {
    const dir = dirAux()
    expect(mismaRuta(dir, join(dir, "tui.json"))).toBe(false)
  })
})
