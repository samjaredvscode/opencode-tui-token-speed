import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const DIR = import.meta.dir
const auxiliares: string[] = []

afterEach(() => {
  while (auxiliares.length > 0) rmSync(auxiliares.pop()!, { recursive: true, force: true })
})

// Un «opencode» de mentira: declara dónde vive la configuración sin tocar el host real.
function hostFalso(configDir: string): string {
  const bin = mkdtempSync(join(tmpdir(), "host-falso-"))
  auxiliares.push(bin)
  writeFileSync(join(bin, "opencode"), `#!/bin/sh\necho "config ${configDir}"\n`)
  chmodSync(join(bin, "opencode"), 0o755)
  return bin
}

interface EntornoFalso { configDir: string; rutaTui: string; pluginDir: string; base: string }

// El plugin se ejecuta desde una copia colocada donde el host realmente lo buscará:
// si no, la comprobación de ubicación que hace setup lo rechazaría (que es lo correcto).
function escenario(tui?: string): EntornoFalso {
  const raiz = mkdtempSync(join(tmpdir(), "cfg-"))
  auxiliares.push(raiz)
  const configDir = join(raiz, "opencode")
  const pluginDir = join(configDir, "tui-plugins", "token-speed")
  mkdirSync(pluginDir, { recursive: true })
  for (const entrada of readdirSync(DIR)) {
    if (entrada === "node_modules" || entrada === ".git") continue
    const origen = join(DIR, entrada)
    if (!statSync(origen).isFile()) continue
    copyFileSync(origen, join(pluginDir, entrada))
  }
  symlinkSync(join(DIR, "node_modules"), join(pluginDir, "node_modules"))
  const rutaTui = join(configDir, "tui.json")
  if (tui !== undefined) writeFileSync(rutaTui, tui)
  return { configDir, rutaTui, pluginDir, base: hostFalso(configDir) }
}

function ejecutarCLI(script: string, entorno: EntornoFalso, extra: string[] = []) {
  const res = Bun.spawnSync({
    cmd: ["bun", "run", join(entorno.pluginDir, script), ...extra],
    cwd: entorno.pluginDir,
    env: { ...process.env, PATH: `${entorno.base}:${process.env.PATH}` },
  })
  return { codigo: res.exitCode, salida: `${res.stdout.toString()}${res.stderr.toString()}` }
}

describe("setup", () => {
  test("registra el plugin en una configuración recién creada", () => {
    const entorno = escenario()
    const res = ejecutarCLI("setup.ts", entorno, ["--skip-deps"])
    expect(res.codigo).toBe(0)
    const config = JSON.parse(readFileSync(entorno.rutaTui, "utf-8"))
    expect(config.plugin).toEqual(["./tui-plugins/token-speed/tui.tsx"])
    expect(config.plugin_enabled["internal:sidebar-context"]).toBe(false)
  })

  test("no toca tui.json al repetir la instalación", () => {
    const entorno = escenario('{"$schema":"https://opencode.ai/tui.json","plugin":["./tui-plugins/token-speed/tui.tsx"],"plugin_enabled":{"internal:sidebar-context":false}}')
    const antes = readFileSync(entorno.rutaTui, "utf-8")
    const res = ejecutarCLI("setup.ts", entorno, ["--skip-deps"])
    expect(res.codigo).toBe(0)
    expect(res.salida).toContain("ya estaba registrado")
    expect(readFileSync(entorno.rutaTui, "utf-8")).toBe(antes)
  })

  test("no escribe nada si el repositorio no está donde el host lo buscará", () => {
    const entorno = escenario('{"$schema":"https://opencode.ai/tui.json"}')
    const res = ejecutarCLI("setup.ts", entorno, ["--skip-deps"])
    expect(res.codigo).toBe(0)
    expect(res.salida).toContain("Plugin donde el host lo buscará")
  })

  test("aborta sin escribir si la ubicación no sirve", () => {
    const entorno = escenario('{"$schema":"https://opencode.ai/tui.json"}')
    const res = Bun.spawnSync({
      cmd: ["bun", "run", join(DIR, "setup.ts"), "--skip-deps"],
      cwd: DIR,
      env: { ...process.env, PATH: `${entorno.base}:${process.env.PATH}` },
    })
    const salida = `${res.stdout.toString()}${res.stderr.toString()}`
    expect(res.exitCode).toBe(1)
    expect(salida).toContain("no está donde el host buscará")
    expect(salida).toContain("No se ha tocado tui.json")
    expect(readFileSync(entorno.rutaTui, "utf-8")).not.toContain("token-speed")
  })

  test("reporta como fallo un tui.json con la forma equivocada en vez de reventar", () => {
    const entorno = escenario('{"plugin":"./algo.tsx"}')
    const res = ejecutarCLI("setup.ts", entorno, ["--skip-deps"])
    expect(res.codigo).toBe(1)
    expect(res.salida).toContain("FALLO")
    expect(res.salida).not.toContain("at setup.ts")
  })

  test("el aviso de clave desconocida aparece y se conserva la clave", () => {
    const entorno = escenario('{"plugin_enabled":{}, "clave_rara": 1}')
    const res = ejecutarCLI("setup.ts", entorno, ["--skip-deps"])
    expect(res.salida).toContain("clave_rara")
    expect(JSON.parse(readFileSync(entorno.rutaTui, "utf-8")).clave_rara).toBe(1)
  })

  test("--dry-run no escribe el registro", () => {
    const entorno = escenario('{"$schema":"https://opencode.ai/tui.json"}')
    const res = ejecutarCLI("setup.ts", entorno, ["--skip-deps", "--dry-run"])
    expect(res.salida).toContain("Simulación")
    expect(readFileSync(entorno.rutaTui, "utf-8")).not.toContain("token-speed")
  })

  test("--help documenta que dry-run no evita bun install", () => {
    const entorno = escenario()
    const res = ejecutarCLI("setup.ts", entorno, ["--help"])
    expect(res.salida).toContain("sí ejecuta bun install")
  })
})

describe("setup y uninstall juntos", () => {
  test("la copia de seguridad conserva el contenido original del usuario", () => {
    const entorno = escenario('{"$schema":"https://opencode.ai/tui.json","theme":"sistema"}')
    ejecutarCLI("setup.ts", entorno, ["--skip-deps"])
    ejecutarCLI("uninstall.ts", entorno)
    expect(JSON.parse(readFileSync(`${entorno.rutaTui}.bak`, "utf-8")).theme).toBe("sistema")
  })

  test("desinstalar restituye exactamente el tui.json de partida", () => {
    const original = '{\n  "$schema": "https://opencode.ai/tui.json",\n  "theme": "sistema"\n}\n'
    const entorno = escenario(original)
    ejecutarCLI("setup.ts", entorno, ["--skip-deps"])
    ejecutarCLI("uninstall.ts", entorno)
    expect(readFileSync(entorno.rutaTui, "utf-8")).toBe(original)
  })

  test("desinstalar dos veces no rompe nada", () => {
    const entorno = escenario('{"$schema":"https://opencode.ai/tui.json","theme":"sistema"}')
    ejecutarCLI("setup.ts", entorno, ["--skip-deps"])
    const primera = ejecutarCLI("uninstall.ts", entorno)
    const segunda = ejecutarCLI("uninstall.ts", entorno)
    expect(primera.codigo).toBe(0)
    expect(segunda.codigo).toBe(0)
    expect(segunda.salida).toContain("no contenía nada de este plugin")
  })

  test("uninstall --dry-run no afirma haber restituido nada", () => {
    const entorno = escenario('{"$schema":"https://opencode.ai/tui.json"}')
    ejecutarCLI("setup.ts", entorno, ["--skip-deps"])
    const res = ejecutarCLI("uninstall.ts", entorno, ["--dry-run"])
    expect(res.salida).toContain("quedaría restituido")
    expect(res.salida).not.toContain("\nOK Indicador de contexto nativo restituido")
    expect(readFileSync(entorno.rutaTui, "utf-8")).toContain("token-speed")
  })

  test("uninstall sin --purge conserva node_modules", () => {
    const entorno = escenario('{"$schema":"https://opencode.ai/tui.json"}')
    ejecutarCLI("setup.ts", entorno, ["--skip-deps"])
    ejecutarCLI("uninstall.ts", entorno)
    expect(existsSync(join(entorno.pluginDir, "node_modules", "gpt-tokenizer"))).toBe(true)
  })
})

describe("verify", () => {
  test("falla cuando el plugin no está registrado", () => {
    const entorno = escenario('{"$schema":"https://opencode.ai/tui.json"}')
    const res = ejecutarCLI("verify.ts", entorno, ["--skip-tests"])
    expect(res.codigo).toBe(1)
    expect(res.salida).toContain("La entrada del plugin aparece 0 veces")
  })

  test("detecta la entrada duplicada", () => {
    const entrada = "./tui-plugins/token-speed/tui.tsx"
    const entorno = escenario(`{"plugin":["${entrada}","${entrada}"],"plugin_enabled":{"internal:sidebar-context":false}}`)
    const res = ejecutarCLI("verify.ts", entorno, ["--skip-tests"])
    expect(res.codigo).toBe(1)
    expect(res.salida).toContain("2 veces")
  })

  test("detecta el indicador nativo no desactivado", () => {
    const entrada = "./tui-plugins/token-speed/tui.tsx"
    const entorno = escenario(`{"plugin":["${entrada}"]}`)
    const res = ejecutarCLI("verify.ts", entorno, ["--skip-tests"])
    expect(res.salida).toContain("no está desactivado")
  })

  test("da el visto bueno con la instalación completa", () => {
    const entorno = escenario('{"$schema":"https://opencode.ai/tui.json"}')
    ejecutarCLI("setup.ts", entorno, ["--skip-deps"])
    const res = ejecutarCLI("verify.ts", entorno, ["--skip-tests"])
    expect(res.codigo).toBe(0)
    expect(res.salida).toContain("0 fallos")
  })
})