#!/usr/bin/env bun
import { existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { mismoConfig, removePluginEntry, restoreNativeContext } from "./config"
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
let dirConfig: string
try {
  dirConfig = resolveConfigDir(ejecutar, process.env)
} catch (error) {
  lineas.push({ estado: "fallo", titulo: "No se pudo localizar la configuración de OpenCode", detalle: error instanceof Error ? error.message : String(error) })
  process.exit(imprimir(lineas))
}
const rutaTui = join(dirConfig, "tui.json")

try {
  const original = leerConfig(rutaTui)
  const fusionado = restoreNativeContext(removePluginEntry(original))
  const escritura = escribirConfig(rutaTui, fusionado, { dryRun })

  if (!escritura.cambio) {
    lineas.push({ estado: "ok", titulo: "tui.json no contenía nada de este plugin" })
  } else if (escritura.escrito) {
    lineas.push({
      estado: "ok",
      titulo: Object.keys(fusionado).length === 0 ? `tui.json quedaba vacío: se ha eliminado ${rutaTui}` : `Desregistrado de ${rutaTui}`,
      detalle: existsSync(`${rutaTui}.bak`) ? `Copia del contenido previo en ${rutaTui}.bak` : undefined,
    })
  } else {
    lineas.push({ estado: "aviso", titulo: `Simulación: se escribiría ${rutaTui}` })
  }

  // Solo se afirma lo que cambió: en --dry-run no se ha restituido nada todavía.
  const contextoRestituido = !mismoConfig(original, fusionado)
  if (contextoRestituido) {
    lineas.push({
      estado: dryRun ? "aviso" : "ok",
      titulo: dryRun ? "El indicador de contexto nativo quedaría restituido" : "Indicador de contexto nativo restituido",
    })
  }
} catch (error) {
  lineas.push({ estado: "fallo", titulo: `No se pudo desregistrar de ${rutaTui}`, detalle: error instanceof Error ? error.message : String(error) })
}

if (purgar) {
  const destino = join(DIR, "node_modules")
  if (!existsSync(join(DIR, "package.json"))) {
    lineas.push({ estado: "fallo", titulo: `No se borra ${destino}: el directorio no parece el plugin`, detalle: `Falta ${join(DIR, "package.json")}` })
  } else if (dryRun) {
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