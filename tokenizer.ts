import { countTokens as countModern, setMergeCacheSize as setModernCache } from "gpt-tokenizer/encoding/o200k_base"
import { countTokens as countLegacy, setMergeCacheSize as setLegacyCache } from "gpt-tokenizer/encoding/cl100k_base"

// No conservar texto generado en el cache de fusiones entre llamadas.
setModernCache(0)
setLegacyCache(0)
const ordinaryText = { disallowedSpecial: new Set<string>() }

export function getReferenceEncoding(modelID?: string): "o200k_base" | "cl100k_base" {
  const model = modelID?.split("/").pop()?.toLowerCase() ?? ""
  return /^gpt-(?:3\.5(?:-|$)|4(?:$|-(?:\d|turbo)))/.test(model) ? "cl100k_base" : "o200k_base"
}

export function countOutputTokens(text: string, modelID?: string): number {
  const count = getReferenceEncoding(modelID) === "cl100k_base" ? countLegacy : countModern
  return count(text, ordinaryText)
}
