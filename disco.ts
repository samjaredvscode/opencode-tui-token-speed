import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
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

  mkdirSync(dirname(ruta), { recursive: true })
  if (actual !== null) copyFileSync(ruta, respaldo)
  writeFileSync(ruta, contenido)
  resultado.escrito = true
  return resultado
}