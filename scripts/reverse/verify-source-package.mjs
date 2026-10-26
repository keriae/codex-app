import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronFuses from '@electron/fuses'
import fuseConstants from '@electron/fuses/dist/constants.js'
import { extractFile } from '@electron/asar'

const { getCurrentFuseWire, FuseV1Options } = electronFuses
const { FuseState } = fuseConstants
const execFileAsync = promisify(execFile)
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = resolve(process.argv[2] || join(repository, 'release/mac-arm64/Codex.app'))
const evidenceDirectory = resolve(process.argv[3] || join(repository, 'reverse/raw/checks/source-package'))
const evidence = join(evidenceDirectory, 'report.json')
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const report = {schemaVersion: 1, checkedAt: new Date().toISOString(), bundle, checks: {}, failures: [], runtimeInteraction: 'not assessed by this package verifier; see runtime-ui.json when present', originalApplicationModified: false}
async function files(root) {
  const result = []
  for (const entry of await readdir(root, {withFileTypes: true})) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) result.push(...await files(path))
    else if (entry.isFile()) result.push(path)
  }
  return result.sort()
}
try {
  const packageInfo = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'))
  const testReport = JSON.parse(await readFile(join(evidenceDirectory, 'tests.json'), 'utf8'))
  report.tests = {files: testReport.testResults.length, passed: testReport.numPassedTests, failed: testReport.numFailedTests, success: testReport.success}
  if (!testReport.success) report.failures.push('Test suite did not pass')
  const signature = await execFileAsync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle])
  report.checks.codesignDeepStrict = true
  report.signatureVerification = signature.stderr.trim().split('\n').filter((line) => line.startsWith(bundle))
  report.bundleId = (await execFileAsync('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', join(bundle, 'Contents/Info.plist')])).stdout.trim()
  if (report.bundleId !== 'com.openai.codex.replica') report.failures.push('Unexpected bundle identity')
  const wire = await getCurrentFuseWire(bundle)
  report.fuseVersion = wire.version
  report.fuses = {}
  for (const [name, index] of Object.entries(FuseV1Options)) {
    if (!Number.isInteger(index)) continue
    if (![FuseState.ENABLE, FuseState.DISABLE].includes(wire[index])) {
      report.failures.push(`Unexpected fuse state: ${name}`)
    }
    const actual = wire[index] === FuseState.ENABLE
    report.fuses[name] = actual
    const expectedKey = name[0].toLowerCase() + name.slice(1)
    if (actual !== packageInfo.build.electronFuses[expectedKey]) report.failures.push(`Fuse mismatch: ${name}`)
  }
  report.checks.fusesReadBack = report.failures.every((failure) => !failure.startsWith('Fuse mismatch'))
  const asar = join(bundle, 'Contents/Resources/app.asar')
  report.asarSha256 = digest(await readFile(asar))
  const outputFiles = await files(join(repository, 'out'))
  report.packagedOutput = {files: outputFiles.length, identical: 0}
  for (const file of outputFiles) {
    const packagedPath = relative(repository, file).split('\\').join('/')
    if (digest(await readFile(file)) === digest(extractFile(asar, packagedPath))) report.packagedOutput.identical += 1
    else report.failures.push(`Packaged output differs: ${packagedPath}`)
  }
  report.checks.latestOutputPackaged = report.packagedOutput.files === report.packagedOutput.identical
  report.sourceHashes = Object.fromEntries(await Promise.all((await files(join(repository, 'src'))).map(async (file) => [relative(repository, file), digest(await readFile(file))])))
} catch (error) { report.failures.push(error instanceof Error ? error.message : String(error)) }
report.passed = report.failures.length === 0
await mkdir(dirname(evidence), {recursive: true})
await writeFile(evidence, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({bundle: report.bundle, tests: report.tests, checks: report.checks, packagedOutput: report.packagedOutput, passed: report.passed, failures: report.failures}, null, 2))
if (!report.passed) process.exitCode = 1
