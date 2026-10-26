import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  APP_ENTRY_URL,
  installPermissionDenyPolicy,
  replicaProfileName,
  resolveReplicaUserDataDirectory,
  resolveRendererAssetFilePath,
  resolveRendererAssetPath
} from './runtimeSecurity'

describe('app renderer protocol', () => {
  const rendererRoot = join(process.cwd(), 'out', 'renderer')

  it('maps the target entry URL and relative Vite assets inside the renderer root', () => {
    expect(resolveRendererAssetPath(APP_ENTRY_URL, rendererRoot)).toBe(
      join(rendererRoot, 'index.html')
    )
    expect(resolveRendererAssetPath('app://-/assets/index-abc.js', rendererRoot)).toBe(
      join(rendererRoot, 'assets', 'index-abc.js')
    )
  })

  it('rejects other origins, credentials, malformed escapes, and path traversal', () => {
    expect(resolveRendererAssetPath('https://-/index.html', rendererRoot)).toBeNull()
    expect(resolveRendererAssetPath('app://other/index.html', rendererRoot)).toBeNull()
    expect(resolveRendererAssetPath('app://user@-/index.html', rendererRoot)).toBeNull()
    expect(resolveRendererAssetPath('app://-/%E0%A4%A', rendererRoot)).toBeNull()
    expect(resolveRendererAssetPath('app://-/%2Fetc/passwd', rendererRoot)).toBeNull()
    expect(resolveRendererAssetPath('app://-/', rendererRoot)).toBeNull()
  })

  it('canonicalizes existing assets and rejects symlinks that escape the renderer root', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'codex-renderer-protocol-'))
    const fixtureRenderer = join(fixtureRoot, 'renderer')
    const outsideDirectory = join(fixtureRoot, 'outside')
    await mkdir(join(fixtureRenderer, 'assets'), { recursive: true })
    await mkdir(outsideDirectory)
    await writeFile(join(fixtureRenderer, 'assets', 'index.js'), 'export {}')
    await writeFile(join(outsideDirectory, 'secret.txt'), 'not renderer data')
    await symlink(outsideDirectory, join(fixtureRenderer, 'escape'))

    try {
      const canonicalAssetPath = await realpath(join(fixtureRenderer, 'assets', 'index.js'))
      await expect(
        resolveRendererAssetFilePath('app://-/assets/index.js', fixtureRenderer)
      ).resolves.toBe(canonicalAssetPath)
      await expect(
        resolveRendererAssetFilePath('app://-/escape/secret.txt', fixtureRenderer)
      ).resolves.toBeNull()
      await expect(
        resolveRendererAssetFilePath('app://-/assets', fixtureRenderer)
      ).resolves.toBeNull()
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true })
    }
  })
})

describe('runtime profile isolation', () => {
  it('keeps development and packaged profiles distinct', () => {
    expect(replicaProfileName(false)).toBe('Codex Replica Development')
    expect(replicaProfileName(true)).toBe('Codex Replica')
    expect(replicaProfileName(false)).not.toBe(replicaProfileName(true))
  })

  it('uses the default profile below Electron appData when no override is provided', () => {
    expect(resolveReplicaUserDataDirectory('/tmp/electron-data', false)).toBe(
      '/tmp/electron-data/Codex Replica Development'
    )
    expect(resolveReplicaUserDataDirectory('/tmp/electron-data', true, '')).toBe(
      '/tmp/electron-data/Codex Replica'
    )
  })

  it('accepts and normalizes an absolute isolated profile override', () => {
    expect(
      resolveReplicaUserDataDirectory('/ignored', false, '/tmp/codex-demo/../codex-demo-profile')
    ).toBe('/tmp/codex-demo-profile')
  })

  it('rejects relative, malformed, and filesystem-root overrides', () => {
    expect(() =>
      resolveReplicaUserDataDirectory('/tmp/electron-data', false, 'relative/profile')
    ).toThrow('must be an absolute path')
    expect(() =>
      resolveReplicaUserDataDirectory('/tmp/electron-data', false, '/tmp/profile\0escape')
    ).toThrow('must be an absolute path')
    expect(() => resolveReplicaUserDataDirectory('/tmp/electron-data', false, '/')).toThrow(
      'cannot be a filesystem root'
    )
  })
})

describe('Chromium permission policy', () => {
  it('denies both permission checks and requests by default', () => {
    let checkHandler: ((...args: unknown[]) => boolean) | undefined
    let requestHandler:
      | ((
          webContents: unknown,
          permission: unknown,
          callback: (allowed: boolean) => void,
          details: unknown
        ) => void)
      | undefined

    installPermissionDenyPolicy({
      setPermissionCheckHandler(handler) {
        checkHandler = handler
      },
      setPermissionRequestHandler(handler) {
        requestHandler = handler
      }
    })

    expect(checkHandler?.({ mainFrame: {} }, 'notifications', 'app://-', {
      isMainFrame: true
    })).toBe(false)

    const callback = vi.fn()
    requestHandler?.({ mainFrame: {} }, 'media', callback, { isMainFrame: true })
    expect(callback).toHaveBeenCalledOnce()
    expect(callback).toHaveBeenCalledWith(false)
  })
})
