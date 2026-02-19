'use strict'

const { isBare } = require('which-runtime')
const { Session } = require('inspector')
const fs = require('fs')
const path = require('path')
const Transformer = require('./lib/transformer')
const process = require('process')

module.exports = async function setupCoverage(opts = {}) {
  const cwd = process.cwd()
  const dir = path.resolve(opts.dir ?? 'coverage')
  const session = new Session()
  session.connect()

  const sessionPost = (...args) =>
    new Promise((resolve, reject) =>
      session.post(...args, (err, result) => (err ? reject(err) : resolve(result)))
    )

  await sessionPost('Profiler.enable')
  await sessionPost('Profiler.startPreciseCoverage', {
    callCount: true,
    detailed: true
  })

  process.once('beforeExit', async () => {
    const v8Report = await sessionPost('Profiler.takePreciseCoverage')
    isBare ? session.destroy() : session.disconnect()

    if (opts.skipRawDump !== true) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'v8-coverage.json'), JSON.stringify(v8Report))
    }

    const reporters = Array.isArray(opts.reporters) ? opts.reporters : ['text', 'json']

    const transformer = new Transformer({ ...opts, cwd })
    const coverageMap = await transformer.transformToCoverageMap(v8Report)
    if (reporters.includes('json')) {
      fs.writeFileSync(path.join(dir, 'coverage-final.json'), JSON.stringify(coverageMap))
    }
    if (reporters.includes('text')) transformer.report(coverageMap)
  })
}
