const { chmodSync, existsSync, statSync } = require('node:fs')
const { resolve } = require('node:path')

function prepareNodePty(root = resolve(__dirname, '..')) {
  if (process.platform !== 'darwin') return []

  const helpers = ['arm64', 'x64']
    .map((arch) => resolve(root, 'node_modules', 'node-pty', 'prebuilds', `darwin-${arch}`, 'spawn-helper'))
    .filter((helper) => existsSync(helper))

  if (helpers.length === 0) {
    throw new Error('node-pty macOS spawn-helper was not installed')
  }

  for (const helper of helpers) {
    const currentMode = statSync(helper).mode & 0o777
    chmodSync(helper, currentMode | 0o111)
  }
  return helpers
}

if (require.main === module) {
  for (const helper of prepareNodePty()) console.log(`Prepared executable node-pty helper: ${helper}`)
}

module.exports = async function beforePack() {
  prepareNodePty()
}
module.exports.prepareNodePty = prepareNodePty
