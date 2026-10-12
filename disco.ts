import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { parseTuiConfig, mismoConfig, renderTuiConfig, parseVersion, type HostRange, type TuiConfig } from "./config"

// El rango de host declarado en package.json decide qué se avisa, no qué se bloquea.
export function leerRangoHost(rutaPaquete: string): HostRange | null {
  if (!existsSync(rutaPaquete)) return null
  const paquete = JSON.parse(readFileSync(rutaPaquete, "utf-8")) as { opencodeHost?: Partial<HostRange> }
  const declarado = paquete.opencodeHost
  if (!declarado?.tested || !declarado.min || !declarado.max) return null
  const rango: HostRange = { tested: declarado.tested, min: declarado.min, max: declarado.max }
  const completo = Object.values(rango).every((valor) => parseVersion(valor) !== null)
  return completo ? rango : null
}

export function leerConfig(ruta: string): TuiConfig {
  if (!existsSync(ruta)) return {}
  return parseTuiConfig(readFileSync(ruta, "utf-8"), ruta)
}

// writeFileSync y copyFileSync siguen enlaces simbólicos y truncan en el sitio: un tui.json
// plantado como enlace escribiría fuera del directorio de configuración.
function exigirFicheroReal(ruta: string, que: string): void {
  if (existsSync(ruta) && lstatSync(ruta).isSymbolicLink()) {
    throw new Error(`${ruta} es un enlace simbólico. Se niega a escribir ${que} a través de él.`)
  }
}

export type Escritura = {
  cambio: boolean
  escrito: boolean
  respaldo?: string
}

export function escribirConfig(
  ruta: string,
  config: TuiConfig,
  opciones: { dryRun?: boolean } = {},
): Escritura {
  const contenido = renderTuiConfig(config)
  const actual = existsSync(ruta) ? readFileSync(ruta, "utf-8") : null
  if (actual === contenido) return { cambio: false, escrito: false }

  if (actual !== null) {
    let previo: TuiConfig | null = null
    try {
      previo = parseTuiConfig(actual, ruta)
    } catch {
      // Un tui.json ilegible sí se sustituye: es el estado que el instalador puede arreglar.
      previo = null
    }
    if (previo && mismoConfig(previo, config)) return { cambio: false, escrito: false }
  }

  const respaldo = `${ruta}.bak`
  const resultado: Escritura = { cambio: true, escrito: false, respaldo }
  if (opciones.dryRun) return resultado

  const directorio = dirname(ruta)
  if (!existsSync(directorio) || !statSync(directorio).isDirectory()) {
    throw new Error(`${directorio} no existe como directorio. Instala y arranca OpenCode antes de ejecutar esta herramienta.`)
  }
  exigirFicheroReal(ruta, "la configuración")
  exigirFicheroReal(respaldo, "la copia de seguridad")

  // La primera copia es la del usuario: no se pisa, o un setup seguido de un uninstall
  // dejarían como único original el estado generado por la herramienta.
  if (actual !== null && !existsSync(respaldo)) copyFileSync(ruta, respaldo)

  // Escribir en un temporal del mismo directorio y renombrar deja el destino intacto o
  // entero: nunca un tui.json a medias que impida arrancar el host.
  const temporal = `${ruta}.tmp-${process.pid}`
  writeFileSync(temporal, contenido)
  renameSync(temporal, ruta)
  resultado.escrito = true
  return resultado
}