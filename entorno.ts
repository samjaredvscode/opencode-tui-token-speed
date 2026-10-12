import { realpathSync } from "node:fs"
import { isAbsolute, resolve, sep } from "node:path"
import { spawnSync } from "node:child_process"

export type Resultado = { ok: boolean; stdout: string; stderr?: string; status?: number; error?: string }

export type Run = (cmd: string[]) => Resultado

export type Entorno = { HOME?: string; XDG_CONFIG_HOME?: string; [clave: string]: string | undefined }

// Ejecuta un comando devolviendo solo lo necesario para decidir.
export const ejecutar = (cmd: string[], opciones: { cwd?: string } = {}): Resultado => {
  const res = spawnSync(cmd[0]!, cmd.slice(1), {
    encoding: "utf-8",
    timeout: 120_000,
    ...(opciones.cwd ? { cwd: opciones.cwd } : {}),
  })
  return {
    ok: !res.error && res.status === 0,
    stdout: String(res.stdout ?? ""),
    stderr: String(res.stderr ?? ""),
    status: typeof res.status === "number" ? res.status : undefined,
    error: res.error ? String((res.error as NodeJS.ErrnoException).code ?? res.error.message) : undefined,
  }
}

export function parseDebugPaths(stdout: string): Record<string, string> {
  const rutas: Record<string, string> = {}
  for (const linea of stdout.split("\n")) {
    const separacion = linea.search(/\s/)
    if (separacion <= 0) continue
    const clave = linea.slice(0, separacion).trim()
    const valor = linea.slice(separacion).trim()
    if (clave && valor) rutas[clave] = valor
  }
  return rutas
}

// La salida del host se trata como dato no confiable: se exige una ruta absoluta y se
// resuelve a una forma estable, sin salto de directorio pendiente. Un «opencode» antes en
// el PATH puede decidir dónde escribe esta herramienta, así que el instalador muestra
// siempre la ruta elegida en pantalla.
export function rutaSegura(valor: string | undefined): string | null {
  if (!valor) return null
  const candidata = valor.trim()
  if (!isAbsolute(candidata)) return null
  const normalizada = resolve(candidata)
  return normalizada === sep ? null : normalizada
}

// El host es la autoridad sobre dónde vive su configuración; el resto es respaldo
// para cuando todavía no se puede ejecutar (instalación en un equipo nuevo).
export function resolveConfigDir(run: Run, env: Entorno): string {
  const declarada = rutaSegura(parseDebugPaths(run(["opencode", "debug", "paths"]).stdout).config)
  if (declarada) return declarada
  if (env.XDG_CONFIG_HOME) return joinPath(env.XDG_CONFIG_HOME, "opencode")
  if (env.HOME) return joinPath(env.HOME, ".config", "opencode")
  throw new Error("No se puede determinar la ruta de configuración: faltan HOME y XDG_CONFIG_HOME.")
}

function joinPath(base: string, ...resto: string[]): string {
  return resolve(base.replace(/\/+$/, ""), ...resto)
}

// La entrada de tui.json es relativa al fichero de configuración: solo se cumple si el
// repositorio está exactamente donde el host va a buscarlo. Comparar por realpath cubre
// el caso de un clon a través de un enlace simbólico.
export function mismaRuta(izquierda: string, derecha: string): boolean {
  const canonica = (ruta: string): string => {
    try {
      return realpathSync(ruta)
    } catch {
      return resolve(ruta)
    }
  }
  return canonica(izquierda) === canonica(derecha)
}