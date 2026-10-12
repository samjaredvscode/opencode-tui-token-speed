#!/usr/bin/env bun
import { rmSync } from "node:fs"
import { join } from "node:path"
import { removePluginEntry, restoreNativeContext } from "./config"
import { escribirConfig, leerConfig } from "./disco"
import { ejecutar, resolveConfigDir } from "./entorno"
import { imprimir, type Linea } from "./informe"

const DIR = import.meta.dir
const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const purgar = args.includes("--purge")

if (args.includes("--help")) {
  console.log("Uso: bun run uninstall [--dry-run] [--purge]\n\n  --dry-run  no escribe nada\n  --purge    borra además node_modules")
  process.exit(0)
}

const lineas: Linea[] = []
const dirConfig = resolveConfigDir(ejecutar, process.env)
const rutaTui = join(dirConfig, "tui.json")

try {
  const config = leerConfig(rutaTui)
  const fusionado = restoreNativeContext(removePluginEntry(config))
  const escritura = escribirConfig(rutaTui, fusionado, { dryRun })
  lineas.push(!escritura.cambio
    ? { estado: "ok", titulo: "tui.json no tenía nada de este plugin" }
    : escritura.escrito
      ? { estado: "ok", titulo: `Desregistrado de ${rutaTui}`, detalle: `Copia del anterior en ${escritura.respaldo}` }
      : { estado: "aviso", titulo: `Simulación: se escribiría ${rutaTui}` })
  lineas.push({ estado: "ok", titulo: "Indicador de contexto nativo restituido" })
} catch (error) {
  lineas.push({ estado: "fallo", titulo: `No se pudo desregistrar de ${rutaTui}`, detalle: error instanceof Error ? error.message : String(error) })
}

if (purgar) {
  const destino = join(DIR, "node_modules")
  if (dryRun) {
    lineas.push({ estado: "aviso", titulo: `Simulación: se borraría ${destino}` })
  } else {
    rmSync(destino, { recursive: true, force: true })
    lineas.push({ estado: "ok", titulo: "node_modules eliminado" })
  }
} else {
  lineas.push({ estado: "aviso", titulo: "node_modules se conserva (usa --purge para borrarlo)" })
}

const salida = imprimir(lineas)
console.log()
console.log("Reinicia OpenCode para que el cambio surta efecto.")
process.exit(salida)