import { spawnSync } from "node:child_process"

export type Resultado = { ok: boolean; stdout: string; stderr?: string; status?: number }

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

// El host es la autoridad sobre dónde vive su configuración; el resto es respaldo
// para cuando todavía no se puede ejecutar (instalación en un equipo nuevo).
export function resolveConfigDir(run: Run, env: Entorno): string {
  let declarada: string | undefined
  try {
    const resultado = run(["opencode", "debug", "paths"])
    declarada = resultado.ok ? parseDebugPaths(resultado.stdout).config : undefined
  } catch (error) {
    // El host no se puede ejecutar (no está instalado o no está en el PATH):
    // se continúa con el respaldo en lugar de abortar la instalación.
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
  }
  if (declarada) return declarada
  if (env.XDG_CONFIG_HOME) return `${env.XDG_CONFIG_HOME.replace(/\/+$/, "")}/opencode`
  if (env.HOME) return `${env.HOME.replace(/\/+$/, "")}/.config/opencode`
  throw new Error("No se puede determinar la ruta de configuración: faltan HOME y XDG_CONFIG_HOME.")
}