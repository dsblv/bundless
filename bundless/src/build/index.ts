import { assertNumberTypeAnnotation } from '@babel/types'
import * as esbuild from 'esbuild'
import fromEntries from 'fromentries'
import fs from 'fs-extra'
import path from 'path'
import posthtml, { Node } from 'posthtml'
import { BuildConfig, Config, getEntries } from '../config'
import { MAIN_FIELDS } from '../constants'
import { Graph } from '../graph'
import { logger } from '../logger'
import { createPluginsExecutor, wrapPluginForEsbuild } from '../plugin'
import * as plugins from '../plugins'
import {
    commonEsbuildOptions,
    generateDefineObject,
    metafileToBundleMap,
    resolvableExtensions,
} from '../prebundle/esbuild'
import {
    isUrl,
    osAgnosticPath,
    runFunctionOnPaths,
    stripColon,
} from '../prebundle/support'
import { metaToTraversalResult } from '../prebundle/traverse'
import { cleanUrl, partition } from '../utils'

// how to get entrypoints? to support multi entry i should let the user pass them, for the single entry i can just get public/index.html or index.html
// TODO add watch feature for build
// TODO build for SSR, sets target to node, do not polyfill node stuff
// TODO esbuild recreates the directory tree, this means the index.js for the index.html can be not in root, this could be mitigated by reusing the web bundles?
// TODO esbuild creates too many chunks
export async function build({
    // TODO get args from config
    config,
    minify = false,
    outDir = 'out',
    env = {},
    jsTarget = 'es2018',
    basePath = '/',
}: BuildConfig & {
    config: Config
}) {
    if (!process.env.NODE_ENV) {
        logger.log(`setting env.NODE_ENV = 'production'`)
        process.env.NODE_ENV = 'production'
    }

    const root = config.root!
    const userPlugins = config.plugins || []
    const entryPoints = getEntries(config)
    await fs.remove(outDir)
    await fs.ensureDir(outDir)
    const publicDir = path.resolve(root, 'public')
    const metafile = path.resolve(outDir, 'metafile.json')
    const esbuildCwd = process.cwd()
    if (fs.existsSync(publicDir)) {
        await fs.copy(publicDir, outDir)
    }
    const emptyGraph = new Graph({ root })

    const allPlugins = [
        plugins.UrlResolverPlugin(),
        plugins.NodeResolvePlugin({
            name: 'node-resolve',
            onNonResolved: (p) => {
                throw new Error(`Cannot resolve '${p}'`)
            },
            onResolved: (p) => {
                // console.log(p)
            },
            mainFields: MAIN_FIELDS,
            extensions: resolvableExtensions,
        }),
        plugins.NodeModulesPolyfillPlugin(),
        // html ingest should override other html plugins in build, this is because html is transformed to js
        plugins.HtmlIngestPlugin({
            root,
            name: 'html-ingest',
            transformImportPath: cleanUrl,
        }),
        ...userPlugins,
    ]
    const pluginsExecutor = createPluginsExecutor({
        plugins: allPlugins,
        config,
        graph: emptyGraph,
        root,
    })
    const buildResult = await esbuild.build({
        ...commonEsbuildOptions,
        metafile,
        entryPoints, // TODO transform html with plugin executor
        bundle: true,
        platform: 'browser',
        target: jsTarget,
        publicPath: basePath,
        splitting: true,
        // external: externalPackages,
        minifyIdentifiers: Boolean(minify),
        minifySyntax: Boolean(minify),
        minifyWhitespace: Boolean(minify),
        mainFields: MAIN_FIELDS,
        define: generateDefineObject({ env }),
        plugins: [
            ...allPlugins.map((plugin) =>
                wrapPluginForEsbuild({
                    config,
                    graph: emptyGraph,
                    plugin,
                    pluginsExecutor,
                }),
            ),
        ],
        // tsconfig: tsconfigTempFile,
        format: 'esm',
        write: true,
        outdir: outDir,
        minify: Boolean(minify),
    })

    let meta: esbuild.Metadata = JSON.parse(
        await (await fs.promises.readFile(metafile)).toString(),
    )
    meta = runFunctionOnPaths(meta, (p) => {
        p = stripColon(p) // namespace:/path/to/file -> /path/to/file
        return p
    })

    const bundleMap = metafileToBundleMap({
        entryPoints,
        esbuildCwd,
        meta,
        root,
    })

    if (!Object.keys(bundleMap).length) {
        return
    }

    const traversalGraph = await metaToTraversalResult({
        meta,
        entryPoints,
        root,
        esbuildCwd,
    })

    const cssToInject: Record<string, string[]> = fromEntries(
        entryPoints.map((x) => osAgnosticPath(x, root)).map((k) => [k, []]),
    )

    // find all the css files, for every entry file traverse its imports and collect all css files, add the css outputs to cssToInject
    for (let entry of entryPoints.map((x) => osAgnosticPath(x, root))) {
        traverseGraphDown({
            entryPoints: [entry],
            traversalGraph,
            onNode(imported) {
                if (cleanUrl(imported).endsWith('.css')) {
                    const abs = path.resolve(root, imported)
                    let output = Object.keys(meta.outputs).find((x) => {
                        if (!x.endsWith('.css')) {
                            return
                        }
                        const info = meta.outputs[x]
                        const absInputs = new Set(
                            Object.keys(info.inputs).map((x) =>
                                path.resolve(esbuildCwd, x),
                            ),
                        )
                        if (absInputs.has(abs)) {
                            return true
                        }
                    })
                    if (!output) {
                        throw new Error(`Cannot find output for '${imported}'`)
                    }
                    output = path.resolve(esbuildCwd, output)
                    cssToInject[entry].push(output)
                }
            },
        })
    }

    for (let entry of entryPoints) {
        if (path.extname(entry) === '.html') {
            const relativePath = osAgnosticPath(entry, root)
            if (!bundleMap[relativePath]) {
                throw new Error(
                    `Cannot find output for '${relativePath}' in ${JSON.stringify(
                        bundleMap,
                        null,
                        4,
                    )}`,
                )
            }
            let outputJs = path.resolve(root, bundleMap[relativePath]!)
            // let outputHtmlPath = path.resolve(
            //     root,
            //     path.dirname(bundleMap[relativePath]!),
            //     path.basename(entry),
            // )
            // await fs.copyFile(entry, outputHtmlPath)
            let html = await (await fs.readFile(entry)).toString()
            // transform html can inject scripts, do SSR, ...
            const htmlResult = await pluginsExecutor.transform({
                contents: html,
                path: path.resolve(root, entry),
                namespace: 'file',
            })
            html = htmlResult?.contents || html
            const transformer = posthtml(
                [
                    (tree) => {
                        // remove previous script tags
                        tree.walk((node) => {
                            if (
                                node &&
                                node.tag === 'script' &&
                                node.attrs &&
                                node.attrs['type'] === 'module' &&
                                node.attrs['src'] &&
                                !isUrl(node.attrs['src'])
                            ) {
                                // TODO maybe leave script tags that are not resolved by plugin executor, maybe they are loaded from some cdn or who knows what, resolver should be able to resolve relative urls
                                node.tag = false as any
                                node.content = []
                            }
                            return node
                        })
                        // add new output files back to html
                        tree.match({ tag: 'body' }, (node) => {
                            const jsSrc = '/' + path.relative(outDir, outputJs)
                            node.content = [
                                MyNode({
                                    tag: 'script',
                                    attrs: { type: 'module', src: jsSrc },
                                }),

                                ...(node.content || []),
                            ]
                            return node
                        })

                        // insert head if missing
                        if (!/<head\b/.test(html)) {
                            if (/<html\b/.test(html)) {
                                tree.match({ tag: 'html' }, (html) => {
                                    html.content = insertAfterStrings(
                                        html.content,
                                        MyNode({ tag: 'head', content: [] }),
                                    )
                                    return html
                                })
                            } else {
                                if (Array.isArray(tree)) {
                                    tree = Object.assign(
                                        tree,
                                        insertAfterStrings(
                                            tree,
                                            MyNode({
                                                tag: 'head',
                                                content: [],
                                            }),
                                        ),
                                    )
                                }
                            }
                        }

                        tree.match({ tag: 'head' }, (node) => {
                            const cssHrefs =
                                cssToInject[osAgnosticPath(entry, root)] || []
                            node.content = [
                                // TODO maybe include imported fonts as links?
                                ...cssHrefs.map((href) => {
                                    href = '/' + path.relative(outDir, href)
                                    return MyNode({
                                        tag: 'link',
                                        attrs: { href, rel: 'stylesheet' },
                                    })
                                }),
                                ...(node.content || []),
                            ]
                            return node
                        })
                    },
                    // !minify && beautify({ rules: { indent: 2 } }),
                ].filter(Boolean),
            )

            const result = await transformer.process(html)
            let outputDirname = path.normalize(
                path.dirname(path.relative(root, entry)),
            )
            // remove `public` from entry path
            if (outputDirname.startsWith('public/')) {
                outputDirname = outputDirname.slice('public/'.length)
            }

            const outputHtmlPath = path.resolve(
                outDir,
                outputDirname,
                path.basename(entry),
            )
            await fs.writeFile(outputHtmlPath, result.html)

            // emit html to dist directory, in dirname same as the output files corresponding to html entries
        } else {
            // TODO support js entries
            // if entry is not html, create an html file that imports the js output bundle
        }
    }
}

function insertAfterStrings(items, node) {
    const [strings, nonStrings] = partition(items, (x) => typeof x === 'string')
    return [...strings, node, ...nonStrings]
}

function MyNode(x: Partial<Node>): Node {
    return x as any
}

function traverseGraphDown(args: {
    traversalGraph: Record<string, string[]>
    entryPoints: string[]
    onNode
}) {
    const { entryPoints, traversalGraph, onNode } = args
    const toVisit: string[] = entryPoints
    const visited = new Set<string>()
    while (toVisit.length) {
        const entry = toVisit.shift()
        if (!entry || visited.has(entry)) {
            break
        }
        visited.add(entry)
        const imports = traversalGraph[entry]
        if (!imports) {
            throw new Error(
                `Node for '${entry}' not found in graph: ${JSON.stringify(
                    JSON.stringify(Object.keys(traversalGraph), null, 4),
                )}`,
            )
        }
        if (onNode) {
            onNode(entry)
        }
        toVisit.push(...imports)
    }
}
