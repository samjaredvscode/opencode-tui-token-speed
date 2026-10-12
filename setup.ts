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
} from "./config"
import { escribirConfig, leerConfig, leerRangoHost } from "./disco"
import { ejecutar, resolveConfigDir } from "./entorno"
import { imprimir, type Linea } from "./informe"

const DIR = import.meta.dir
const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const saltarDeps = args.includes("--skip-deps")

if (args.includes("--help")) {
  console.log("Uso: bun run setup [--dry-run] [--skip-deps]\n\n  --dry-run   muestra qué haría sin escribir nada\n  --skip-deps no ejecuta bun install")
  process.exit(0)
}

const lineas: Linea[] = []
const dirConfig = resolveConfigDir(ejecutar, process.env)
const rutaTui = join(dirConfig, "tui.json")

lineas.push({ estado: "ok", titulo: `Configuración del host: ${dirConfig}` })

const rango = leerRangoHost(join(DIR, "package.json"))
const version = ejecutar(["opencode", "--version"])
if (!version.ok) {
  lineas.push({ estado: "aviso", titulo: "No se pudo consultar la versión del host", detalle: (version.stderr ?? "").trim() || "opencode no está en el PATH" })
} else {
  const detectada = parseVersion(version.stdout.trim().split("\n").pop() ?? "")
  if (!rango) {
    lineas.push({ estado: "aviso", titulo: "package.json no declara opencodeHost; sin comprobación de versión" })
  } else if (isHostSupported(detectada, rango)) {
    lineas.push({ estado: "ok", titulo: `Host ${detectada!.major}.${detectada!.minor}.${detectada!.patch} dentro del rango probado` })
  } else {
    lineas.push({ estado: "aviso", titulo: "Versión del host fuera del rango probado", detalle: formatHostWarning(detectada, rango) })
  }
}

if (saltarDeps) {
  lineas.push({ estado: "aviso", titulo: "Dependencias omitidas por --skip-deps" })
} else {
  const instalacion = ejecutar(["bun", "install", "--frozen-lockfile", "--ignore-scripts"], { cwd: DIR })
  lineas.push(instalacion.ok
    ? { estado: "ok", titulo: "Dependencias instaladas desde el lockfile" }
    : { estado: "fallo", titulo: "bun install falló", detalle: (instalacion.stderr || instalacion.stdout).trim() })
}

const tokenizer = join(DIR, "node_modules", "gpt-tokenizer")
lineas.push(existsSync(tokenizer)
  ? { estado: "ok", titulo: "gpt-tokenizer presente" }
  : { estado: "fallo", titulo: "gpt-tokenizer ausente; ejecuta bun install en el directorio del plugin" })

let config: ReturnType<typeof leerConfig>
try {
  config = leerConfig(rutaTui)
} catch (error) {
  lineas.push({ estado: "fallo", titulo: `No se pudo leer ${rutaTui}`, detalle: error instanceof Error ? error.message : String(error) })
  imprimir(lineas)
  process.exit(1)
}

const desconocidas = findUnknownKeys(config)
if (desconocidas.length > 0) {
  lineas.push({
    estado: "aviso",
    titulo: `tui.json tiene claves que el host no admite: ${desconocidas.join(", ")}`,
    detalle: "El esquema no permite claves desconocidas y el host no arrancará hasta que se quiten.",
  })
}

const fusionado = mergePluginEnabled(mergePluginEntry(config))
const escritura = escribirConfig(rutaTui, fusionado, { dryRun })
if (!escritura.cambio) {
  lineas.push({ estado: "ok", titulo: "tui.json ya estaba registrado; no se toca" })
} else if (escritura.escrito) {
  lineas.push({ estado: "ok", titulo: `Registro escrito en ${rutaTui}`, detalle: `Copia del anterior en ${escritura.respaldo}` })
} else {
  lineas.push({ estado: "aviso", titulo: `Simulación: se escribiría ${rutaTui}` })
}

const salida = imprimir(lineas)
console.log()
console.log("Reinicia OpenCode para que cargue el plugin: la configuración no se recarga en caliente.")
process.exit(salida)