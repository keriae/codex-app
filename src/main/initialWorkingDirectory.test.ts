import { describe, expect, it } from 'vitest'
import { resolveInitialWorkingDirectory } from './initialWorkingDirectory'

const finderLaunch = { args: [], environmentWorkspace: '', processCwd: '/', homeDirectory: '/Users/example' }

describe('macOS initial working directory', () => {
  it('uses the user directory for an implicit Finder filesystem-root launch', () => {
    expect(resolveInitialWorkingDirectory(finderLaunch)).toEqual({ cwd: '/Users/example', source: 'home' })
    expect(resolveInitialWorkingDirectory({ ...finderLaunch, processCwd: '/volume/..' })).toEqual({ cwd: '/Users/example', source: 'home' })
  })

  it('preserves an explicit filesystem root instead of treating it as a Finder fallback', () => {
    expect(resolveInitialWorkingDirectory({ ...finderLaunch, args: ['--cwd=/'] })).toEqual({ cwd: '/', source: 'argument' })
    expect(resolveInitialWorkingDirectory({ ...finderLaunch, environmentWorkspace: '/' })).toEqual({ cwd: '/', source: 'environment' })
  })

  it('keeps a launch argument ahead of an environment workspace', () => {
    expect(resolveInitialWorkingDirectory({ ...finderLaunch, args: ['--cwd=/projects/argument'], environmentWorkspace: '/projects/environment' }))
      .toEqual({ cwd: '/projects/argument', source: 'argument' })
  })

  it('keeps an environment workspace ahead of a shell process directory', () => {
    expect(resolveInitialWorkingDirectory({ ...finderLaunch, processCwd: '/projects/shell', environmentWorkspace: '/projects/environment' }))
      .toEqual({ cwd: '/projects/environment', source: 'environment' })
  })

  it('retains a non-root shell or development working directory', () => {
    expect(resolveInitialWorkingDirectory({ ...finderLaunch, processCwd: '/projects/shell' })).toEqual({ cwd: '/projects/shell', source: 'process' })
  })

  it('resolves relative launch overrides against the real process directory', () => {
    expect(resolveInitialWorkingDirectory({ ...finderLaunch, processCwd: '/projects/shell', args: ['--cwd=../other project'] }))
      .toEqual({ cwd: '/projects/other project', source: 'argument' })
    expect(resolveInitialWorkingDirectory({ ...finderLaunch, processCwd: '/projects/shell', environmentWorkspace: '../environment' }))
      .toEqual({ cwd: '/projects/environment', source: 'environment' })
  })

  it('ignores an empty cwd argument while preserving the environment override', () => {
    expect(resolveInitialWorkingDirectory({ ...finderLaunch, args: ['--cwd='], environmentWorkspace: '/projects/environment' }))
      .toEqual({ cwd: '/projects/environment', source: 'environment' })
  })
})
