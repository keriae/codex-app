import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

/** Decode the installed bundle's artwork without launching the application. */
export async function loadMacWorkspaceApplicationIcon(applicationPath: string): Promise<string | undefined> {
  let temporary: string | undefined
  try {
    const { stdout } = await execute('/usr/bin/plutil', [
      '-extract', 'CFBundleIconFile', 'raw', '-o', '-', join(applicationPath, 'Contents', 'Info.plist')
    ], { timeout: 3000, maxBuffer: 4096 })
    const name = stdout.trim()
    if (!name || basename(name) !== name || name === '.' || name === '..') return undefined
    const resource = join(applicationPath, 'Contents', 'Resources', extname(name) ? name : `${name}.icns`)
    const metadata = await stat(resource)
    if (!metadata.isFile() || metadata.size > 32 * 1024 * 1024) return undefined
    temporary = await mkdtemp(join(tmpdir(), 'codex-workspace-icon-'))
    const output = join(temporary, 'icon.png')
    // Electron getFileIcon(.app) returns generic application artwork on current
    // macOS. sips decodes the bundle's actual ICNS with native ImageIO instead.
    await execute('/usr/bin/sips', ['-s', 'format', 'png', '-z', '32', '32', resource, '--out', output], { timeout: 5000, maxBuffer: 4096 })
    const png = await readFile(output)
    return png.length <= 1024 * 1024 && png.subarray(0, 8).equals(PNG_SIGNATURE) ? `data:image/png;base64,${png.toString('base64')}` : undefined
  } catch { return undefined }
  finally { if (temporary) await rm(temporary, { recursive: true, force: true }).catch(() => {}) }
}
