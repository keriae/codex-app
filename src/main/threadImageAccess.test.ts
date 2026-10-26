import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_THREAD_IMAGE_BYTES,
  readThreadImage,
  ThreadImagePathGrants
} from './threadImageAccess'

const temporaryDirectories: string[] = []
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'codex-thread-images-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

describe('thread image path grants', () => {
  it('extracts only image item path fields from trusted app-server payloads', () => {
    const grants = new ThreadImagePathGrants()
    const circular: Record<string, unknown> = {}
    circular.self = circular

    grants.grantFromTrustedPayload({
      thread: {
        turns: [
          {
            items: [
              {
                type: 'imageView',
                path: '/synthetic/view.png',
                savedPath: '/synthetic/not-an-image-view-field.png'
              },
              {
                type: 'imageGeneration',
                savedPath: '/synthetic/generated.png',
                result: '/synthetic/generated-result.webp',
                path: '/synthetic/not-an-image-generation-field.png'
              },
              {
                type: 'userMessage',
                content: [
                  { type: 'localImage', path: '/synthetic/user-message.png' },
                  { type: 'text', path: '/synthetic/text-part.png' }
                ]
              },
              { type: 'commandExecution', path: '/synthetic/command-path.png' },
              { type: 'imageView', path: 'relative.png' },
              { type: 'imageGeneration', result: 'data:image/png;base64,AAAA' }
            ]
          }
        ]
      },
      unrelatedPath: '/synthetic/unrelated.png',
      circular
    })

    expect(grants.allows('/synthetic/view.png')).toBe(true)
    expect(grants.allows('/synthetic/generated.png')).toBe(true)
    expect(grants.allows('/synthetic/generated-result.webp')).toBe(true)
    expect(grants.allows('/synthetic/user-message.png')).toBe(true)
    expect(grants.allows('/synthetic/text-part.png')).toBe(false)
    expect(grants.allows('/synthetic/not-an-image-view-field.png')).toBe(false)
    expect(grants.allows('/synthetic/not-an-image-generation-field.png')).toBe(false)
    expect(grants.allows('/synthetic/command-path.png')).toBe(false)
    expect(grants.allows('/synthetic/unrelated.png')).toBe(false)
    expect(grants.allows('relative.png')).toBe(false)
  })

  it('keeps a bounded least-recently-granted capability set', () => {
    const grants = new ThreadImagePathGrants(2)
    grants.grantFromPicker([
      '/synthetic/one.png',
      '/synthetic/two.png',
      '/synthetic/three.png'
    ])

    expect(grants.allows('/synthetic/one.png')).toBe(false)
    expect(grants.allows('/synthetic/two.png')).toBe(true)
    expect(grants.allows('/synthetic/three.png')).toBe(true)
  })
})

describe('thread image reader', () => {
  it('rejects renderer-chosen absolute paths without a trusted grant', async () => {
    const request = vi.fn(async () => ({ dataBase64: pngBytes.toString('base64') }))

    await expect(
      readThreadImage({ request }, new ThreadImagePathGrants(), '/synthetic/private.png')
    ).rejects.toThrow('not authorized')
    expect(request).not.toHaveBeenCalled()
  })

  it('reads a picker-authorized image through the app-server file bridge', async () => {
    const directory = await temporaryDirectory()
    const path = join(directory, 'selected.png')
    await writeFile(path, pngBytes)
    const grants = new ThreadImagePathGrants()
    grants.grantFromPicker([path])
    const request = vi.fn(async () => ({ dataBase64: pngBytes.toString('base64') }))

    await expect(readThreadImage({ request }, grants, path)).resolves.toEqual({
      path,
      mimeType: 'image/png',
      dataBase64: pngBytes.toString('base64'),
      sizeBytes: pngBytes.byteLength
    })
    expect(request).toHaveBeenCalledWith('fs/readFile', { path })
  })

  it('rejects non-images and oversized images before reading through app-server', async () => {
    const directory = await temporaryDirectory()
    const textPath = join(directory, 'not-an-image.png')
    const largePath = join(directory, 'large.png')
    await writeFile(textPath, 'not actually an image')
    await writeFile(largePath, Buffer.alloc(MAX_THREAD_IMAGE_BYTES + 1, 0x61))
    const grants = new ThreadImagePathGrants()
    grants.grantFromPicker([textPath, largePath])
    const request = vi.fn(async () => ({ dataBase64: '' }))

    await expect(readThreadImage({ request }, grants, textPath)).rejects.toThrow(
      'not a supported raster image'
    )
    await expect(readThreadImage({ request }, grants, largePath)).rejects.toThrow(
      'too large to preview'
    )
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects malformed base64 and content that does not match the inspected image', async () => {
    const directory = await temporaryDirectory()
    const path = join(directory, 'server-image.png')
    await writeFile(path, pngBytes)
    const grants = new ThreadImagePathGrants()
    grants.grantFromTrustedPayload({ type: 'imageView', path })

    await expect(
      readThreadImage(
        { request: vi.fn(async () => ({ dataBase64: '%%%%' })) },
        grants,
        path
      )
    ).rejects.toThrow('Invalid or oversized thread image response')

    await expect(
      readThreadImage(
        {
          request: vi.fn(async () => ({
            dataBase64: Buffer.from('12345678').toString('base64')
          }))
        },
        grants,
        path
      )
    ).rejects.toThrow('changed while the preview was loading')
  })
})
