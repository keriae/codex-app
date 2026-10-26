import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_MAX_JSON_LINE_BYTES,
  JsonLineLimitError,
  JsonLineParser
} from './jsonl'

describe('JsonLineParser', () => {
  it('parses messages split across arbitrary chunks', () => {
    const values: Array<Record<string, unknown>> = []
    const parser = new JsonLineParser({ onValue: (value) => values.push(value) })
    const encoded = new TextEncoder().encode(
      '{"id":1,"result":{"text":"你好"}}\n{"method":"turn/completed","params":{}}\n'
    )

    parser.push(encoded.slice(0, 19))
    parser.push(encoded.slice(19, 33))
    parser.push(encoded.slice(33))

    expect(values).toEqual([
      { id: 1, result: { text: '你好' } },
      { method: 'turn/completed', params: {} }
    ])
  })

  it('accepts CRLF, blank lines, and a final line without newline', () => {
    const values: Array<Record<string, unknown>> = []
    const parser = new JsonLineParser({ onValue: (value) => values.push(value) })

    parser.push('\r\n{"id":"a","result":1}\r\n')
    parser.push('{"method":"ready"}')
    parser.end()

    expect(values).toEqual([{ id: 'a', result: 1 }, { method: 'ready' }])
  })

  it('accepts a full turn response larger than the legacy 8 MiB ceiling', () => {
    const values: Array<Record<string, unknown>> = []
    const onError = vi.fn()
    const parser = new JsonLineParser({
      onValue: (value) => values.push(value),
      onError
    })
    const transcript = 'x'.repeat(9 * 1024 * 1024)

    parser.push('{"id":1,"result":{"transcript":"')
    parser.push(transcript)
    parser.push('"}}\n')

    expect(DEFAULT_MAX_JSON_LINE_BYTES).toBe(16 * 1024 * 1024)
    expect(onError).not.toHaveBeenCalled()
    expect(values).toHaveLength(1)
    expect(
      ((values[0].result as Record<string, unknown>).transcript as string).length
    ).toBe(transcript.length)
  })

  it('reports malformed lines and continues parsing', () => {
    const values: Array<Record<string, unknown>> = []
    const onError = vi.fn()
    const parser = new JsonLineParser({
      onValue: (value) => values.push(value),
      onError
    })

    parser.push('{bad json}\n{"id":2,"result":"ok"}\n')

    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0][1]).toBe('{bad json}')
    expect(values).toEqual([{ id: 2, result: 'ok' }])
  })

  it('drops an oversized line and resumes at the next newline', () => {
    const values: Array<Record<string, unknown>> = []
    const onError = vi.fn()
    const parser = new JsonLineParser({
      maxLineBytes: 16,
      maxBufferBytes: 64,
      onValue: (value) => values.push(value),
      onError
    })

    parser.push('{"oversized":"')
    parser.push('xxxxxxxxxxxxxxxxxxxxxxxx"}\n{"id":3}\n')

    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(JsonLineLimitError)
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      name: 'JsonLineLimitError',
      kind: 'line',
      limitBytes: 16
    })
    expect(values).toEqual([{ id: 3 }])
  })

  it('caps accumulated partial input and recovers after discarding it', () => {
    const values: Array<Record<string, unknown>> = []
    const onError = vi.fn()
    const parser = new JsonLineParser({
      maxLineBytes: 128,
      maxBufferBytes: 12,
      onValue: (value) => values.push(value),
      onError
    })

    parser.push('{"partial":')
    parser.push('123456789')
    parser.push('\n{"ok":true}\n')

    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(JsonLineLimitError)
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      name: 'JsonLineLimitError',
      kind: 'buffer',
      limitBytes: 12
    })
    expect(values).toEqual([{ ok: true }])
  })

  it('rejects invalid hard limits', () => {
    expect(
      () => new JsonLineParser({ maxLineBytes: 0, onValue: () => undefined })
    ).toThrow('maxLineBytes must be a positive integer')
  })
})
