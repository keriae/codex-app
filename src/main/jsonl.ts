export type JsonLineValue = Record<string, unknown>

// A single paginated turn can legitimately exceed 8 MiB when it contains a
// large tool transcript. Keep stdio parity with the app-server WebSocket
// transport, whose default inbound frame ceiling is 16 MiB.
export const DEFAULT_MAX_JSON_LINE_BYTES = 16 * 1024 * 1024
export const DEFAULT_MAX_JSON_BUFFER_BYTES = 16 * 1024 * 1024

export class JsonLineLimitError extends Error {
  constructor(
    readonly kind: 'line' | 'buffer',
    readonly limitBytes: number
  ) {
    super(
      kind === 'line'
        ? `JSON line exceeds the ${limitBytes}-byte limit`
        : `JSON parser buffer exceeds the ${limitBytes}-byte limit`
    )
    this.name = 'JsonLineLimitError'
  }
}

export interface JsonLineParserOptions {
  onValue(value: JsonLineValue): void
  onError?(error: Error, line: string): void
  maxLineBytes?: number
  maxBufferBytes?: number
}

/**
 * Incremental newline-delimited JSON parser. app-server writes one JSON object per
 * line, but stdout chunks may split a UTF-8 sequence or contain several messages.
 */
export class JsonLineParser {
  private readonly decoder = new TextDecoder()
  private buffer = ''
  private bufferBytes = 0
  private discardingLine = false
  private readonly maxLineBytes: number
  private readonly maxBufferBytes: number

  constructor(private readonly options: JsonLineParserOptions) {
    this.maxLineBytes = positiveLimit(
      options.maxLineBytes,
      DEFAULT_MAX_JSON_LINE_BYTES,
      'maxLineBytes'
    )
    this.maxBufferBytes = positiveLimit(
      options.maxBufferBytes,
      DEFAULT_MAX_JSON_BUFFER_BYTES,
      'maxBufferBytes'
    )
  }

  push(chunk: Uint8Array | string): void {
    const decoded =
      typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true })
    this.consume(decoded)
  }

  end(): void {
    this.consume(this.decoder.decode())
    if (this.discardingLine) {
      this.resetLine()
      return
    }
    if (this.buffer.trim()) this.parse(this.buffer.replace(/\r$/, ''))
    this.resetLine()
  }

  private consume(value: string): void {
    let offset = 0
    let newlineIndex = value.indexOf('\n', offset)
    while (newlineIndex >= 0) {
      this.append(value.slice(offset, newlineIndex))
      this.finishLine()
      offset = newlineIndex + 1
      newlineIndex = value.indexOf('\n', offset)
    }
    this.append(value.slice(offset))
  }

  private append(fragment: string): void {
    if (!fragment || this.discardingLine) return

    const fragmentBytes = Buffer.byteLength(fragment)
    const nextBytes = this.bufferBytes + fragmentBytes
    const exceeded =
      nextBytes > this.maxLineBytes
        ? new JsonLineLimitError('line', this.maxLineBytes)
        : nextBytes > this.maxBufferBytes
          ? new JsonLineLimitError('buffer', this.maxBufferBytes)
          : null

    if (exceeded) {
      const preview = `${this.buffer}${fragment}`.slice(0, 240)
      this.options.onError?.(exceeded, preview)
      this.buffer = ''
      this.bufferBytes = 0
      this.discardingLine = true
      return
    }

    this.buffer += fragment
    this.bufferBytes = nextBytes
  }

  private finishLine(): void {
    if (!this.discardingLine) this.parse(this.buffer.replace(/\r$/, ''))
    this.resetLine()
  }

  private resetLine(): void {
    this.buffer = ''
    this.bufferBytes = 0
    this.discardingLine = false
  }

  private parse(line: string): void {
    if (!line.trim()) return

    try {
      const value: unknown = JSON.parse(line)
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Expected a JSON object')
      }
      this.options.onValue(value as JsonLineValue)
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      this.options.onError?.(error, line)
    }
  }
}

function positiveLimit(value: number | undefined, fallback: number, name: string): number {
  const limit = value ?? fallback
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new TypeError(`${name} must be a positive integer`)
  }
  return limit
}
