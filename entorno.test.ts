import { describe, expect, test } from "bun:test"
import { parseDebugPaths, resolveConfigDir } from "./entorno"

const salida = `home       /home/samwsl
data       /home/samwsl/.local/share/opencode
config     /home/samwsl/.config/opencode
cache      /home/samwsl/.cache/opencode
`

const ok = (stdout: string) => () => ({ ok: true, stdout })
const falla = () => () => ({ ok: false, stdout: "" })

describe("parseDebugPaths", () => {
  test("extrae cada clave con su valor", () => {
    expect(parseDebugPaths(salida)).toEqual({
      home: "/home/samwsl",
      data: "/home/samwsl/.local/share/opencode",
      config: "/home/samwsl/.config/opencode",
      cache: "/home/samwsl/.cache/opencode",
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
    const ausente = () => { const error = new Error("no such file") as Error & { code: string }; error.code = "ENOENT"; throw error }
    expect(resolveConfigDir(ausente, { HOME: "/home/x" })).toBe("/home/x/.config/opencode")
  })
})