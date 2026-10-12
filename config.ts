export type TuiConfig = Record<string, unknown>

export type Version = { major: number; minor: number; patch: number }

export type HostRange = { tested: string; min: string; max: string }

// La entrada que el host resuelve relativa al fichero de configuración.
export const PLUGIN_ENTRY = "./tui-plugins/token-speed/tui.tsx"

// Indicador de contexto que este plugin sustituye.
export const NATIVE_CONTEXT = "internal:sidebar-context"

// Claves que https://opencode.ai/tui.json admite. El schema tiene
// additionalProperties:false, así que una clave ajena impide que opencode arranque.
const KNOWN_KEYS = new Set([
  "$schema", "theme", "keybinds", "plugin", "plugin_enabled", "leader_timeout",
  "attention", "prompt", "scroll_speed", "scroll_acceleration", "diff_style",
  "cursor", "mouse",
])

type PluginEntry = string | [string, Record<string, unknown>]

function esListaPlugin(valor: unknown): valor is unknown[] {
  return Array.isArray(valor)
}

function rutaDe(entrada: unknown): string | null {
  if (typeof entrada === "string") return entrada
  if (Array.isArray(entrada) && typeof entrada[0] === "string") return entrada[0]
  return null
}

function entradas(config: TuiConfig): unknown[] {
  const actual = config.plugin
  if (actual === undefined) return []
  if (!esListaPlugin(actual)) {
    throw new Error(`tui.json: «plugin» debe ser una lista, no ${typeof actual}`)
  }
  return [...actual]
}

function habilitados(config: TuiConfig): Record<string, unknown> {
  const actual = config.plugin_enabled
  if (actual === undefined) return {}
  if (typeof actual !== "object" || actual === null || Array.isArray(actual)) {
    throw new Error(`tui.json: «plugin_enabled» debe ser un objeto, no ${Array.isArray(actual) ? "lista" : typeof actual}`)
  }
  return { ...(actual as Record<string, unknown>) }
}

export function findUnknownKeys(config: TuiConfig): string[] {
  return Object.keys(config).filter((key) => !KNOWN_KEYS.has(key)).sort()
}

export function mergePluginEntry(config: TuiConfig, entry: string = PLUGIN_ENTRY): TuiConfig {
  const actuales = entradas(config)
  const vistos = new Set<string>()
  const conservadas = actuales.filter((item) => {
    const ruta = rutaDe(item)
    if (ruta !== entry) return true
    if (vistos.has(ruta)) return false
    vistos.add(ruta)
    return true
  })
  if (!conservadas.some((item) => rutaDe(item) === entry)) conservadas.push(entry)
  return { ...config, plugin: conservadas as PluginEntry[] }
}

export function removePluginEntry(config: TuiConfig, entry: string = PLUGIN_ENTRY): TuiConfig {
  const restantes = entradas(config).filter((item) => rutaDe(item) !== entry)
  const siguiente: TuiConfig = { ...config }
  if (restantes.length === 0) delete siguiente.plugin
  else siguiente.plugin = restantes as PluginEntry[]
  return siguiente
}

export function mergePluginEnabled(config: TuiConfig): TuiConfig {
  return { ...config, plugin_enabled: { ...habilitados(config), [NATIVE_CONTEXT]: false } }
}

// Sin el plugin, dejar el override puesto dejaría al usuario sin indicador de contexto.
export function restoreNativeContext(config: TuiConfig): TuiConfig {
  const restantes = habilitados(config)
  delete restantes[NATIVE_CONTEXT]
  const siguiente: TuiConfig = { ...config }
  if (Object.keys(restantes).length === 0) delete siguiente.plugin_enabled
  else siguiente.plugin_enabled = restantes
  return siguiente
}

export function parseTuiConfig(raw: string, origen = "tui.json"): TuiConfig {
  let valor: unknown
  try {
    valor = JSON.parse(raw)
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error)
    throw new Error(`${origen}: JSON inválido (${motivo}). No se ha modificado nada.`)
  }
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) {
    throw new Error(`${origen}: la configuración debe ser un objeto JSON.`)
  }
  return valor as TuiConfig
}

export function renderTuiConfig(config: TuiConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`
}

// Comparación estructural: dos configuraciones equivalentes no justifican reescribir
// el fichero del usuario solo porque una de ellas está formateada de otra manera.
export function mismoConfig(izquierda: unknown, derecha: unknown): boolean {
  if (izquierda === derecha) return true
  if (typeof izquierda !== "object" || typeof derecha !== "object") return false
  if (izquierda === null || derecha === null) return false
  if (Array.isArray(izquierda) !== Array.isArray(derecha)) return false
  if (Array.isArray(izquierda) && Array.isArray(derecha)) {
    return izquierda.length === derecha.length && izquierda.every((item, i) => mismoConfig(item, derecha[i]))
  }
  const claves = Object.keys(izquierda as object)
  const otras = Object.keys(derecha as object)
  if (claves.length !== otras.length) return false
  return claves.every((clave) =>
    Object.hasOwn(derecha as object, clave) &&
    mismoConfig((izquierda as Record<string, unknown>)[clave], (derecha as Record<string, unknown>)[clave]),
  )
}

export function parseVersion(raw: string): Version | null {
  const encontrado = /^\s*v?(\d+)\.(\d+)\.(\d+)(?:[-+][\w.-]+)?\s*$/.exec(raw)
  if (!encontrado) return null
  const [, major, minor, patch] = encontrado
  return { major: Number(major), minor: Number(minor), patch: Number(patch) }
}

function comparar(left: Version, right: Version): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch
}

export function isHostSupported(version: Version | null, range: HostRange): boolean {
  if (!version) return false
  const min = parseVersion(range.min)
  const max = parseVersion(range.max)
  if (!min || !max) return false
  return comparar(version, min) >= 0 && comparar(version, max) <= 0
}

export function formatHostWarning(version: Version | null, range: HostRange): string {
  const detectada = version ? `${version.major}.${version.minor}.${version.patch}` : "desconocida"
  return [
    `Versión del host ${detectada}, fuera del rango probado ${range.min}–${range.max}`,
    `(probado en ${range.tested}). El plugin usa los slots de la interfaz V1; si el host cambió`,
    "esos slots, el indicador no aparecerá aunque la instalación termine sin error.",
    "Verifica el arranque antes de dar por buena la instalación.",
  ].join(" ")
}