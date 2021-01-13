import fs from 'fs-extra'
import path from 'path'
import {
    BUNDLE_MAP_PATH,
    COMMONJS_ANALYSIS_PATH,
    WEB_MODULES_PATH,
} from '../constants'
import { logger } from '../logger'
import { clearCommonjsAnalysisCache } from '../plugins/rewrite/commonjs'
import { bundleWithEsBuild } from './esbuild'
import { printStats } from './stats'
import { isEmpty, osAgnosticPath } from '../utils'
import { traverseWithEsbuild } from './traverse'

export async function prebundle({ entryPoints, plugins, filter, root, dest }) {
    try {
        const traversalResult = await traverseWithEsbuild({
            entryPoints,
            root,
            plugins,
            stopTraversing: filter,
            esbuildCwd: process.cwd(),
        })

        const dependenciesPaths = traversalResult.filter(filter)

        await fs.remove(dest)

        if (!dependenciesPaths.length) {
            logger.log(`No dependencies to prebundle found`)
            return {}
        }

        logger.spinStart('Prebundling modules')
        logger.log(
            `prebundling [\n    ${dependenciesPaths
                .map((x) => osAgnosticPath(x, root))
                .join('\n    ')}\n]`,
        )

        const { bundleMap, analysis, stats } = await bundleWithEsBuild({
            dest,
            root,
            plugins,
            entryPoints: dependenciesPaths.map((x) => path.resolve(root, x)),
        })

        logger.spinSucceed('\nFinish')

        const analysisFile = path.resolve(dest, COMMONJS_ANALYSIS_PATH)
        await fs.createFile(analysisFile)

        await fs.writeFile(analysisFile, JSON.stringify(analysis, null, 4))
        console.info(
            printStats({ dependencyStats: stats, destLoc: 'web_modules/' }),
        )
        if (!isEmpty(bundleMap)) {
            const bundleMapCachePath = path.resolve(
                root,
                WEB_MODULES_PATH,
                BUNDLE_MAP_PATH,
            )
            await fs.writeJSON(bundleMapCachePath, bundleMap, { spaces: 4 })
        }
        return bundleMap
    } catch (e) {
        logger.spinFail(String(e) + '\n')
        e.message = `Cannot prebundle: ${e.message}`
        throw e
    } finally {
        clearCommonjsAnalysisCache()
    }
}

// on start, check if already optimized dependencies, else
// traverse from entrypoints and get all imported paths, stopping when finding a node_module
// start bundling these modules and store them in a web_modules folder
// save a commonjs modules list in web_modules folder
// this can be a plugin that start building when finding a new node_modules plugin that should not be there
// if it sees a path that has a node_modules inside it blocks the server, start bundling and restart everything
