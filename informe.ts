export type Estado = "ok" | "aviso" | "fallo"

export type Linea = { estado: Estado; titulo: string; detalle?: string }

export type Resumen = { ok: number; aviso: number; fallo: number }

const MARCA: Record<Estado, string> = { ok: "✓", aviso: "!", fallo: "✗" }

export function resume(lineas: readonly Linea[]): Resumen {
  return {
    ok: lineas.filter((linea) => linea.estado === "ok").length,
    aviso: lineas.filter((linea) => linea.estado === "aviso").length,
    fallo: lineas.filter((linea) => linea.estado === "fallo").length,
  }
}

// Un aviso describe una desviación conocida y tolerable; un fallo indica que el
// plugin no puede funcionar y hay que actuar.
export function codigoSalida(resumen: Resumen): number {
  return resumen.fallo > 0 ? 1 : 0
}

export function imprimir(lineas: readonly Linea[]): number {
  for (const linea of lineas) {
    const cabecera = `${MARCA[linea.estado]} ${linea.titulo}`
    console.log(linea.detalle ? `${cabecera}\n    ${linea.detalle}` : cabecera)
  }
  const resumen = resume(lineas)
  console.log(`\n${resumen.ok} correctas · ${resumen.aviso} avisos · ${resumen.fallo} fallos`)
  return codigoSalida(resumen)
}