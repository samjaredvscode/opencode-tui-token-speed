import { describe, expect, test } from "bun:test"
import { startLiveRefresh } from "./refresh"

function reloj() {
  let cancelar = 0
  let pendiente: (() => void) | null = null
  return {
    schedule(update: () => void, _delay: number) {
      pendiente = update
      return () => { cancelar++; pendiente = null }
    },
    disparar() { pendiente?.() },
    cancelaciones() { return cancelar },
  }
}

describe("startLiveRefresh", () => {
  test("actualiza una vez de inmediato al arrancar", () => {
    const relojFalso = reloj()
    let llamadas = 0
    startLiveRefresh(() => { llamadas++ }, new AbortController().signal, relojFalso.schedule)
    expect(llamadas).toBe(1)
  })

  test("repite en cada tick mientras siga activo", () => {
    const relojFalso = reloj()
    let llamadas = 0
    startLiveRefresh(() => { llamadas++ }, new AbortController().signal, relojFalso.schedule)
    relojFalso.disparar()
    relojFalso.disparar()
    expect(llamadas).toBe(3)
  })

  test("no programa nada si la señal ya está abortada", () => {
    const relojFalso = reloj()
    let llamadas = 0
    const controller = new AbortController()
    controller.abort()
    startLiveRefresh(() => { llamadas++ }, controller.signal, relojFalso.schedule)
    expect(llamadas).toBe(0)
    expect(relojFalso.cancelaciones()).toBe(0)
  })

  test("abortar la señal cancela el temporizador y detiene las actualizaciones", () => {
    const relojFalso = reloj()
    let llamadas = 0
    const controller = new AbortController()
    startLiveRefresh(() => { llamadas++ }, controller.signal, relojFalso.schedule)
    controller.abort()
    relojFalso.disparar()
    expect(llamadas).toBe(1)
    expect(relojFalso.cancelaciones()).toBe(1)
  })

  test("la función de parada es idempotente", () => {
    const relojFalso = reloj()
    const controller = new AbortController()
    const parar = startLiveRefresh(() => {}, controller.signal, relojFalso.schedule)
    parar()
    parar()
    parar()
    expect(relojFalso.cancelaciones()).toBe(1)
  })

  test("parar antes de abortar evita la cancelación posterior", () => {
    const relojFalso = reloj()
    const controller = new AbortController()
    const parar = startLiveRefresh(() => {}, controller.signal, relojFalso.schedule)
    parar()
    controller.abort()
    expect(relojFalso.cancelaciones()).toBe(1)
  })

  test("devuelve una función inocua cuando la señal ya estaba abortada", () => {
    const controller = new AbortController()
    controller.abort()
    const parar = startLiveRefresh(() => {}, controller.signal, reloj().schedule)
    expect(() => parar()).not.toThrow()
  })
})