import { describe, expect, test } from "bun:test"
import { codigoSalida, resume, type Linea } from "./informe"

const linea = (estado: Linea["estado"], titulo = "comprobación"): Linea => ({ estado, titulo })

describe("resume", () => {
  test("cuenta los estados", () => {
    const total = resume([linea("ok"), linea("ok"), linea("aviso"), linea("fallo")])
    expect(total.ok).toBe(2)
    expect(total.aviso).toBe(1)
    expect(total.fallo).toBe(1)
  })
})

describe("codigoSalida", () => {
  test("todo correcto devuelve 0", () => {
    expect(codigoSalida(resume([linea("ok"), linea("ok")]))).toBe(0)
  })

  test("un aviso no rompe la instalación", () => {
    expect(codigoSalida(resume([linea("ok"), linea("aviso")]))).toBe(0)
  })

  test("cualquier fallo devuelve 1", () => {
    expect(codigoSalida(resume([linea("ok"), linea("fallo")]))).toBe(1)
  })

  test("sin comprobaciones devuelve 0", () => {
    expect(codigoSalida(resume([]))).toBe(0)
  })
})