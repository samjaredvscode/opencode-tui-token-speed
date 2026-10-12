#!/usr/bin/env bun
import { existsSync } from "node:fs"
import { join } from "node:path"
import {
  findUnknownKeys,
  formatHostWarning,
  isHostSupported,
  mergePluginEnabled,
  mergePluginEntry,
  parseVersion,
  type TuiConfig,
} from "./config"
import { escribirConfig, leerConfig, leerRangoHost } from "./disco"
import { ejecutar, mismaRuta, resolveConfigDir } from "./entorno"
import { imprimir, resume, type Linea } from "./informe"

const DIR = import.meta.dir
const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const saltarDeps = args.includes("--skip-deps")

if (args.includes("--help")) {
  console.log([
    "Uso: bun run setup [--dry-run] [--skip-deps]",
    "",
    "  --dry-run   no escribe en tui.json (sí ejecuta bun install salvo --skip-deps)",
    "  --skip-deps no ejecuta bun install",
  ].join("\n"))
  process.exit(0)
}

const lineas: Linea[] = []

function anota(estado: Linea["estado"], titulo: string, detalle?: string) {
  lineas.push({ estado, titulo, ...(detalle ? { detalle } : {}) })
}

let dirConfig: string
try {
  dirConfig = resolveConfigDir(ejecutar, process.env)
} catch (error) {
  anota("fallo", "No se pudo localizar la configuración de OpenCode", error instanceof Error ? error.message : String(error))
  process.exit(imprimir(lineas))
}
const rutaTui = join(dirConfig, "tui.json")

// La entrada que se registra es relativa a tui.json: si el repositorio no está donde el
// host buscará, el host no lo encontrará y la instalación sería un falso éxito.
const esperado = join(dirConfig, "tui-plugins", "token-speed")
if (mismaRuta(DIR, esperado)) {
  anota("ok", `Plugin donde el host lo buscará: ${esperado}`)
} else {
  anota("fallo", "El repositorio no está donde el host buscará el plugin",
    `Está en ${DIR} y el host sólo resuelve ${esperado}. Muévelo allí o ajusta la entrada de tui.json a mano.`)
}

anota("ok", `Configuración del host: ${dirConfig}`)

const rango = leerRangoHost(join(DIR, "package.json"))
const version = ejecutar(["opencode", "--version"])
if (!version.ok) {
  anota("aviso", "No se pudo consultar la versión del host",
    version.error ? `opencode falló (${version.error}). Continúa igualmente.` : "opencode no está en el PATH")
} else {
  const detectada = parseVersion(version.stdout.trim().split("\n").pop() ?? "")
  if (!rango) {
    anota("aviso", "package.json no declara opencodeHost; sin comprobación de versión")
  } else if (isHostSupported(detectada, rango)) {
    anota("ok", `Host ${detectada!.major}.${detectada!.minor}.${detectada!.patch} dentro del rango probado`)
  } else {
    anota("aviso", "Versión del host fuera del rango probado", formatHostWarning(detectada, rango))
  }
}

if (saltarDeps) {
  anota("aviso", "Dependencias omitidas por --skip-deps")
} else {
  const instalacion = ejecutar(["bun", "install", "--frozen-lockfile", "--ignore-scripts"], { cwd: DIR })
  anota(
    instalacion.ok ? "ok" : "fallo",
    instalacion.ok ? "Dependencias instaladas desde el lockfile" : "bun install falló",
    instalacion.ok ? undefined : (instalacion.stderr || instalacion.stdout).trim(),
  )
}

const tokenizer = join(DIR, "node_modules", "gpt-tokenizer")
if (!existsSync(tokenizer)) {
  anota("fallo", "gpt-tokenizer ausente", "El host no podrá importar el plugin. Ejecuta bun install en el directorio del plugin.")
}

// Nada se escribe si algo ya falló: registrar el plugin sin sus dependencias deja al host
// con un módulo que no carga y al usuario sin indicador.
const hayFallos = resume(lineas).fallo > 0
if (hayFallos) {
  anota("aviso", "No se ha tocado tui.json porque hay comprobaciones en rojo")
  const salida = imprimir(lineas)
  console.log()
  console.log("Corrige lo anterior y vuelve a ejecutar bun run setup.")
  process.exit(salida)
}

let config: TuiConfig
try {
  config = leerConfig(rutaTui)
} catch (error) {
  anota("fallo", `No se pudo leer ${rutaTui}`, error instanceof Error ? error.message : String(error))
  const salida = imprimir(lineas)
  process.exit(salida)
}

const desconocidas = findUnknownKeys(config)
if (desconocidas.length > 0) {
  anota("aviso", `tui.json tiene claves que el host no admite: ${desconocidas.join(", ")}`,
    "El esquema no permite claves desconocidas y el host no arrancará hasta que se quiten.")
}

try {
  const fusionado = mergePluginEnabled(mergePluginEntry(config))
  const escritura = escribirConfig(rutaTui, fusionado, { dryRun })
  if (!escritura.cambio) {
    anota("ok", "tui.json ya estaba registrado; no se toca")
  } else if (escritura.escrito) {
    anota("ok", `Registro escrito en ${rutaTui}`,
      existsSync(`${rutaTui}.bak`) ? `Copia del contenido previo en ${rutaTui}.bak` : undefined)
  } else {
    anota("aviso", `Simulación: se escribiría ${rutaTui}`)
  }
} catch (error) {
  anota("fallo", `No se pudo registrar en ${rutaTui}`,
    error instanceof Error ? error.message : String(error))
}

const salida = imprimir(lineas)
console.log()
console.log("Reinicia OpenCode para que cargue el plugin: la configuración no se recarga en caliente.")
process.exit(salida)