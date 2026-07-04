/**
 * Сжатие снапшотов: gzip (CompressionStream) + base64.
 * Доступно и в браузере, и в Node 18+ (тесты).
 */

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const src = new Blob([data as BlobPart]).stream().pipeThrough(stream)
  const buf = await new Response(src).arrayBuffer()
  return new Uint8Array(buf)
}

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export async function gzipEncode(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const packed = await pipe(bytes, new CompressionStream('gzip'))
  return toBase64(packed)
}

export async function gzipDecode(b64: string): Promise<string> {
  const bytes = fromBase64(b64)
  const unpacked = await pipe(bytes, new DecompressionStream('gzip'))
  return new TextDecoder().decode(unpacked)
}
