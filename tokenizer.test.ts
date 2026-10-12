import { describe, expect, test } from "bun:test"
import { countOutputTokens, getReferenceEncoding } from "./tokenizer"

describe("getReferenceEncoding", () => {
  test("usa la codificación de referencia para GPT-3.5 y GPT-4 legacy", () => {
    expect(getReferenceEncoding("gpt-3.5-turbo")).toBe("cl100k_base")
    expect(getReferenceEncoding("gpt-4")).toBe("cl100k_base")
    expect(getReferenceEncoding("gpt-4-32k")).toBe("cl100k_base")
    expect(getReferenceEncoding("gpt-4-turbo")).toBe("cl100k_base")
  })

  test("usa o200k_base para GPT-4o y para lo que no se reconoce", () => {
    expect(getReferenceEncoding("gpt-4o")).toBe("o200k_base")
    expect(getReferenceEncoding("gpt-5")).toBe("o200k_base")
    expect(getReferenceEncoding("space-bunny-free")).toBe("o200k_base")
  })

  test("ignora el prefijo de proveedor", () => {
    expect(getReferenceEncoding("openai/gpt-4")).toBe("cl100k_base")
    expect(getReferenceEncoding("anthropic/gpt-4")).toBe("cl100k_base")
    expect(getReferenceEncoding("openai/gpt-4o")).toBe("o200k_base")
  })

  test("no confunde gpt-4o con el legacy gpt-4", () => {
    expect(getReferenceEncoding("gpt-4o-mini")).toBe("o200k_base")
  })

  test("sin modelo indicado cae en la codificación moderna", () => {
    expect(getReferenceEncoding(undefined)).toBe("o200k_base")
    expect(getReferenceEncoding("")).toBe("o200k_base")
  })
})

describe("countOutputTokens", () => {
  test("cuenta más tokens un texto más largo", () => {
    const corto = countOutputTokens("hola")
    const largo = countOutputTokens("hola ".repeat(200))
    expect(corto).toBeGreaterThan(0)
    expect(largo).toBeGreaterThan(corto)
  })

  test("devuelve 0 para texto vacío", () => {
    expect(countOutputTokens("")).toBe(0)
  })

  test("devuelve un entero seguro", () => {
    expect(Number.isSafeInteger(countOutputTokens("texto de prueba"))).toBe(true)
  })

  test("el conteo es estable entre llamadas al no usar caché de fusiones", () => {
    const texto = "repetición ".repeat(500)
    expect(countOutputTokens(texto)).toBe(countOutputTokens(texto))
  })
})