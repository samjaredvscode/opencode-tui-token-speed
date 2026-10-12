#!/usr/bin/env bun
import { existsSync } from "node:fs"
import { join } from "node:path"
import { NATIVE_CONTEXT, contarEntradas, findUnknownKeys, isHostSupported, parseVersion } from "./config"
import { leerConfig, leerRangoHost } from "./disco"
import { ejecutar, resolveConfigDir } from "./entorno"
import { imprimir, type Linea } from "./informe"

const DIR = import.meta.dir
const args = process.argv.slice(2)
const sinTests = args.includes("--skip-tests")

if (args.includes("--help")) {
  console.log("Uso: bun run verify [--skip-tests]\n\n  --skip-tests no ejecuta la batería de pruebas de este repositorio")
  process.exit(0)
}

const lineas: Linea[] = []

let dirConfig: string
try {
  dirConfig = resolveConfigDir(ejecutar, process.env)
} catch (error) {
  lineas.push({ estado: "fallo", titulo: "No se pudo localizar la configuración de OpenCode", detalle: error instanceof Error ? error.message : String(error) })
  process.exit(imprimir(lineas))
}
const rutaTui = join(dirConfig, "tui.json")

const rango = leerRangoHost(join(DIR, "package.json"))
const version = ejecutar(["opencode", "--version"])
if (!version.ok) {
  lineas.push({ estado: "fallo", titulo: "opencode no está disponible en el PATH", detalle: version.error })
} else {
  const detectada = parseVersion(version.stdout.trim().split("\n").pop() ?? "")
  const texto = detectada ? `${detectada.major}.${detectada.minor}.${detectada.patch}` : "desconocida"
  const linea: Linea = { estado: "ok", titulo: `Host ${texto}` }
  if (rango && !isHostSupported(detectada, rango)) {
    linea.estado = "aviso"
    linea.detalle = `Fuera del rango probado ${rango.min}–${rango.max}; los slots de la interfaz pueden haber cambiado.`
  }
  lineas.push(linea)
}

if (!rango) lineas.push({ estado: "aviso", titulo: "package.json no declara un rango de host válido" })

lineas.push(existsSync(join(DIR, "node_modules", "gpt-tokenizer"))
  ? { estado: "ok", titulo: "gpt-tokenizer instalado" }
  : { estado: "fallo", titulo: "gpt-tokenizer no está instalado", detalle: "bun install en el directorio del plugin" })

if (!existsSync(rutaTui)) {
  lineas.push({ estado: "fallo", titulo: `No existe ${rutaTui}`, detalle: "Ejecuta bun run setup" })
} else {
  try {
    const config = leerConfig(rutaTui)
    const veces = contarEntradas(config)
    lineas.push(veces === 1
      ? { estado: "ok", titulo: "Entrada del plugin registrada una sola vez" }
      : { estado: "fallo", titulo: `La entrada del plugin aparece ${veces} veces en tui.json`, detalle: "Sin cambio: se cuelga dos veces o no se cuelga." })

    const habilitados = config.plugin_enabled as Record<string, unknown> | undefined
    lineas.push(habilitados?.[NATIVE_CONTEXT] === false
      ? { estado: "ok", titulo: "Indicador de contexto nativo desactivado (sin duplicado)" }
      : { estado: "fallo", titulo: "El indicador de contexto nativo no está desactivado", detalle: "Aparecerán los dos contadores; ejecuta bun run setup." })

    const desconocidas = findUnknownKeys(config)
    lineas.push(desconocidas.length === 0
      ? { estado: "ok", titulo: "tui.json solo contiene claves admitidas" }
      : { estado: "aviso", titulo: `Claves no admitidas por el esquema: ${desconocidas.join(", ")}` })
  } catch (error) {
    lineas.push({ estado: "fallo", titulo: `No se pudo interpretar ${rutaTui}`, detalle: error instanceof Error ? error.message : String(error) })
  }
}

if (sinTests) {
  lineas.push({ estado: "aviso", titulo: "Pruebas omitidas por --skip-tests" })
} else {
  const pruebas = ejecutar(["bun", "test"], { cwd: DIR })
  lineas.push(pruebas.ok
    ? { estado: "ok", titulo: "Batería de pruebas en verde" }
    : { estado: "fallo", titulo: "Hay pruebas en rojo", detalle: (pruebas.stderr ?? "").trim() || pruebas.stdout.trim() })
}

const salida = imprimir(lineas)
console.log()
console.log("Si todo está correcto, reinicia OpenCode: la configuración no se recarga en caliente.")
process.exit(salida)