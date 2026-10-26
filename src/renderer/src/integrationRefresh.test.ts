import { describe, expect, it } from 'vitest'
import { settleIntegrationRead } from './integrationRefresh'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject })
  return { promise, resolve, reject }
}

describe('independent settings inventory reads', () => {
  it('renders plugins and skills while MCP is still pending', async () => {
    const plugins = deferred<string[]>()
    const skills = deferred<string[]>()
    const mcp = deferred<string[]>()
    const values: Partial<Record<'plugins' | 'skills' | 'mcp', string[]>> = {}
    const loading = { plugins: true, skills: true, mcp: true }
    const started: string[] = []
    const launch = (section: keyof typeof loading, promise: Promise<string[]>) => settleIntegrationRead(
      () => { started.push(section); return promise },
      {
        isCurrent: () => true,
        onValue: (value) => { values[section] = value },
        onError: () => { throw new Error('unexpected rejection') },
        onFinished: () => { loading[section] = false }
      }
    )
    const reads = { plugins: launch('plugins', plugins.promise), skills: launch('skills', skills.promise), mcp: launch('mcp', mcp.promise) }
    expect(started).toEqual(['plugins', 'skills', 'mcp'])
    plugins.resolve(['latex'])
    skills.resolve(['compile'])
    await Promise.all([reads.plugins, reads.skills])
    expect(values).toEqual({ plugins: ['latex'], skills: ['compile'] })
    expect(loading).toEqual({ plugins: false, skills: false, mcp: true })
    mcp.resolve(['zotero'])
    await reads.mcp
    expect(values.mcp).toEqual(['zotero'])
    expect(loading.mcp).toBe(false)
  })

  it('settles a rejected provider separately from successful inventories', async () => {
    const mcp = deferred<string[]>()
    const failures: string[] = []
    const completed: string[] = []
    const values: string[] = []
    const reads = [
      settleIntegrationRead(async () => ['latex'], {
        isCurrent: () => true,
        onValue: (value) => { values.push(...value) },
        onError: () => { failures.push('plugins') },
        onFinished: () => { completed.push('plugins') }
      }),
      settleIntegrationRead(() => mcp.promise, {
        isCurrent: () => true,
        onValue: (value) => { values.push(...value) },
        onError: (error) => { failures.push((error as Error).message) },
        onFinished: () => { completed.push('mcp') }
      })
    ]
    await reads[0]
    expect(values).toEqual(['latex'])
    expect(completed).toEqual(['plugins'])
    mcp.reject(new Error('MCP unavailable'))
    await reads[1]
    expect(failures).toEqual(['MCP unavailable'])
    expect(completed).toEqual(['plugins', 'mcp'])
    expect(values).toEqual(['latex'])
  })

  it.each(['resolve', 'reject'] as const)('ignores stale %s and its loading completion', async (outcome) => {
    const read = deferred<string[]>()
    let generation = 1
    const effects: string[] = []
    const pending = settleIntegrationRead(() => read.promise, {
      isCurrent: () => generation === 1,
      onValue: () => { effects.push('value') },
      onError: () => { effects.push('error') },
      onFinished: () => { effects.push('finished') }
    })
    generation += 1
    if (outcome === 'resolve') read.resolve(['old workspace'])
    else read.reject(new Error('old workspace unavailable'))
    await pending
    expect(effects).toEqual([])
  })

  it('finishes a synchronous read failure so its tab cannot remain loading', async () => {
    const effects: string[] = []
    await settleIntegrationRead<string[]>(() => { throw new Error('disconnected') }, {
      isCurrent: () => true,
      onValue: () => { effects.push('value') },
      onError: (error) => { effects.push((error as Error).message) },
      onFinished: () => { effects.push('finished') }
    })
    expect(effects).toEqual(['disconnected', 'finished'])
  })
})
