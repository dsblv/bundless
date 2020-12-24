import { traverseEsModules, urlResolver } from 'es-module-traversal'
import { build, serve, loadConfig } from '@bundless/cli'
import { jsTypeRegex } from '@bundless/cli/dist/utils'
import fs from 'fs-extra'
import glob from 'glob'
import fetch from 'node-fetch'
import path from 'path'
import slash from 'slash'
import { URL } from 'url'
import { isUrl, osAgnosticResult } from './utils'
import 'jest-specific-snapshot'

import * as failFast from 'jasmine-fail-fast'
const jasmineEnv = (jasmine as any).getEnv()
jasmineEnv.addReporter(failFast.init())

it('works', async () => {
    const currentFile = path.resolve(__dirname, __filename)
    const res = await traverseEsModules({
        entryPoints: [currentFile],
    })
})
describe('snapshots', () => {
    const casesPath = 'fixtures'
    const cases = fs
        .readdirSync(casesPath, {
            withFileTypes: true,
        })
        .filter((x) => x.isDirectory())
        .map((x) => x.name)
        .map((x) => path.posix.join(casesPath, x))

    const PORT = '9000'
    const baseUrl = `http://127.0.0.1:${PORT}`

    for (let [i, casePath] of cases.entries()) {
        const snapshotFile = path.resolve(casePath, '__snapshots__')
        test(`${slash(casePath)}`, async () => {
            let root = path.resolve(casePath)
            const config = loadConfig(casePath)
            const server = await serve({ ...config, port: PORT, root })
            const entryPoints = config?.entries || ['index.html']
            try {
                const downloadFilesToDir = path.join(casePath, '__mirror__')
                await fs.remove(downloadFilesToDir)
                const contentTypes = {}
                const res = await traverseEsModules({
                    onNonResolved: (p) => {
                        // throw new Error(`cannot traverse ${p}`)
                    },
                    entryPoints: entryPoints.map((x) =>
                        new URL(x, baseUrl).toString(),
                    ),
                    resolver: urlResolver({ root: casePath, baseUrl }),
                    onEntry: async (url = '', importer) => {
                        let content = ''
                        if (!url) {
                            return
                        }
                        if (!isUrl(url)) {
                            content = await (await fs.readFile(url)).toString()
                        } else {
                            const res = await fetch(url, {
                                headers: {
                                    ...(importer ? { Referer: importer } : {}),
                                },
                            })
                            if (!res.ok) {
                                throw new Error(
                                    `Cannot fetch '${url}', referer is '${importer}': ${
                                        res.statusText
                                    } ${await res.text().catch(() => '')}`,
                                )
                            }
                            contentTypes[url] = res.headers.get('content-type')
                            content = await res.text()
                        }
                        // download files
                        let filePath = url.startsWith('http')
                            ? urlToRelativePath(url)
                            : path.relative(root, url)

                        filePath = path.join(downloadFilesToDir, filePath)

                        await fs.createFile(filePath)
                        await fs.writeFile(filePath, content)
                    },
                })
                for (let url in contentTypes) {
                    if (!url.endsWith('.html')) {
                        expect(contentTypes[url]).toContain(
                            'application/javascript',
                        )
                    }
                }
                expect(contentTypes).toMatchSpecificSnapshot(
                    snapshotFile,
                    'content-type headers',
                )
                expect(res.map(osAgnosticResult)).toMatchSpecificSnapshot(
                    snapshotFile,
                    'traverse result',
                )

                // MIRROR
                const allMirrorFiles = glob.sync(`**/*`, {
                    ignore: ['__snapshots__'],
                    cwd: downloadFilesToDir,
                    nodir: true,
                })
                expect(allMirrorFiles).toMatchSpecificSnapshot(
                    snapshotFile,
                    'mirror',
                )
                // BUILD
                const outDir = path.resolve(casePath, 'dist')
                await build({
                    root,
                    outDir,
                    entryPoints: entryPoints.map((x) => path.resolve(root, x)),
                })
                const allBuildFiles = glob.sync(`**/*`, {
                    ignore: ['__snapshots__'],
                    cwd: outDir,
                    nodir: true,
                })
                expect(allBuildFiles).toMatchSpecificSnapshot(
                    snapshotFile,
                    'build',
                )
            } finally {
                server && (await server.close())
            }
        })
    }
})

function urlToRelativePath(ctx) {
    let pathname = new URL(ctx).pathname
    pathname = pathname.startsWith('/') ? pathname.slice(1) : pathname
    return pathname
}
