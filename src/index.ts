import fs from 'fs'
import path from 'path'
import chalk from 'chalk'
import type { Plugin, ResolvedConfig, UserConfig, SSROptions } from 'vite'
import type { IncomingMessage, ServerResponse } from 'http'
import { mergeConfig, send, build, normalizePath } from 'vite'

// from vite
function emptyDir(dir: string, skip?: string[]): void {
  for (const file of fs.readdirSync(dir)) {
    if (skip?.includes(file)) {
      continue
    }

    const abs = path.resolve(dir, file)

    // baseline is Node 12 so can't use rmSync :(
    if (fs.lstatSync(abs).isDirectory()) {
      emptyDir(abs)
      fs.rmdirSync(abs)
    } else {
      fs.unlinkSync(abs)
    }
  }
}

// from vite
function prepareOutDir(outDir: string, emptyOutDir: boolean | null | undefined, config: ResolvedConfig) {
  if (fs.existsSync(outDir)) {
    if (emptyOutDir == null && !normalizePath(outDir).startsWith(config.root + '/')) {
      // warn if outDir is outside of root
      config.logger.warn(
        chalk.yellow(
          `\n${chalk.bold(`(!)`)} outDir ${chalk.white.dim(
            outDir
          )} is not inside project root and will not be emptied.\n` + `Use --emptyOutDir to override.\n`
        )
      )
    } else if (emptyOutDir !== false) {
      emptyDir(outDir, ['.git'])
    }
  }
}

function info(logger: { info: (value: string) => void }, name: string, value: string) {
  logger.info(`${chalk.blueBright(name)} ${chalk.green(value)}`)
}

export type Manifest = Record<string, string[]>

export interface RenderContext<TModule = any> {
  /** The server request. */
  req: IncomingMessage

  /** The server response. */
  res: ServerResponse

  /** The ssr module that has been resolved by vite. */
  ssr: TModule

  /** The html template string. */
  template: string

  /** The ssr manifest. */
  manifest: Manifest
}

export interface PluginOptions<TModule = any> {
  /** Set the default ssr input, will have no effect when build.ssr is used. */
  ssr?: boolean | string

  /** Defaults to `ssr:manifest` */
  manifestId?: string

  /** Defaults to `ssr:template` */
  templateId?: string

  /** Overwrite vite config when building for production */
  buildConfig?: UserConfig & {
    ssr?: SSROptions
  }

  /** false to disable the output of ssr-manifest.json and index.html file */
  writeManifest: boolean,

  transformManifest?: (manifest: Manifest) => Promise<Manifest | void> | Manifest | void

  /**
   * Apply a transformation to the index.html file, note this will run after any vite just before render is called.
   * It will not run when render is called.
   */
  transformTemplate?: (html: string) => Promise<string | void> | string | void

  /**
   * The ssr render function.
   */
  render?: (context: RenderContext<TModule>) => Promise<string | void> | string | void
}

/**
 * The vite ssr plugin, it apply a middleware to the vite dev server that allow development under ssr without leaving vite.
 */
export default function ssr<TModule = any>(options?: PluginOptions<TModule>): Plugin {
  const SSR_MANIFEST_NAME = options?.manifestId || 'ssr:manifest'
  const SSR_TEMPLATE_NAME = options?.manifestId || 'ssr:template'

  let generateSSRBuild = false
  let emptyOutDir: boolean | null | undefined = null
  let resolvedConfig: ResolvedConfig
  let manifestSource: Manifest = {}
  let templateSource = ''

  async function applyManifestTransformation() {
    let manifest: unknown = await options?.transformManifest?.call(undefined, manifestSource)

    if (typeof manifest === 'string') {
      manifest = JSON.parse(manifest)
    }

    if (manifest && typeof manifest === 'object') {
      // save the manifest
      manifestSource = manifest as Manifest
    }
  }

  async function applyTemplateTransformation() {
    const template: unknown = await options?.transformTemplate?.call(undefined, templateSource)

    if (typeof template === 'string') {
      // save the template
      templateSource = template
    }
  }

  return {
    name: 'armonia-vite-plugin-ssr',
    enforce: 'post',

    config(config, env) {
      if (options?.buildConfig === false) {
        return
      }

      // run only on production build SSR
      if (env.mode !== 'production' || env.command !== 'build' || typeof config.build?.ssr !== 'string') {
        return
      }

      info(console, 'SSR build', `building SSR bundle for ${env.mode}...`)

      generateSSRBuild = true

      // we need to build twice on the same folder, therefore we must do
      // the cleanup process manually
      emptyOutDir = config.build?.emptyOutDir

      // we need to merge twice as publicDir and emptyOutDir *MUST* be set to false
      return mergeConfig(
        mergeConfig(
          {
            // this config will reset some common vite spa config
            // we do not need them in ssr most of the time
            build: {
              // cssCodeSplit: false,
              // minify: false,

              // this will preserve the original file name
              rollupOptions: {
                output: {
                  // format: 'esm',
                  entryFileNames: '[name].js'
                }
              }
            }
          },
          options?.buildConfig || {}
        ),
        {
          publicDir: false, // the client will do this
          build: {
            emptyOutDir: false // or we delete the client files
          }
        }
      )
    },

    configResolved(config) {
      resolvedConfig = config
    },

    transformIndexHtml: {
      // enforce: 'post' will make sure we get
      // the most "recent" html version
      enforce: 'post',

      transform(html) {
        templateSource = html || ''
      }
    },

    resolveId(source) {
      if (source === SSR_MANIFEST_NAME || source === SSR_TEMPLATE_NAME) {
        return source
      }
    },

    load(id) {
      // load the manifest
      if (id === SSR_MANIFEST_NAME) {
        // await applyManifestTransformation()

        return `export default ${JSON.stringify(manifestSource, null, 2)}`
      }

      // load the template
      if (id === SSR_TEMPLATE_NAME) {
        // await applyTemplateTransformation()

        return `export default ${JSON.stringify(templateSource)}`
      }
    },

    configureServer(server) {
      // see: https://vitejs.dev/guide/api-plugin.html#configureserver
      // runs after internal middlewares are installed
      return () => {
        server.middlewares.use(async (req, res, next) => {
          if (res.writableEnded) {
            return next()
          }

          // get the ssr module
          let ssrInput: unknown = options?.ssr || server.config.build?.ssr

          // as documented at https://vitejs.dev/config/#build-ssr
          if (ssrInput === true) {
            ssrInput = server.config.build?.rollupOptions?.input
          }

          const ssrModule = typeof ssrInput === 'string' ? ssrInput : undefined

          // no ssr module
          if (!ssrModule) {
            return next()
          }

          // get only the path, without query or fragment
          const url = req.url && req.url.replace(/#.*$/s, '').replace(/\?.*$/s, '')

          if (url?.endsWith('.html') && req.headers['sec-fetch-dest'] !== 'script') {
            const filename = decodeURIComponent(path.join(server.config.root, url.slice(1)))

            if (fs.existsSync(filename)) {
              try {
                // read the index html file
                let template = fs.readFileSync(filename, 'utf-8')

                // transform the index html file
                template = await server.transformIndexHtml(url, template, req.originalUrl)

                // set the template source
                templateSource = template

                // transform the template
                await applyTemplateTransformation()

                // set the template
                template = templateSource

                // load the ssr module
                const ssr = (await server.ssrLoadModule(ssrModule)) as any

                let renderedTemplate

                // render the html page
                if (options?.render) {
                  renderedTemplate = await options.render({
                    ssr,
                    req,
                    res,
                    template,
                    manifest: manifestSource
                  })
                } else {
                  // the default renderer, it assumes an export named 'render'
                  renderedTemplate = await ssr.render(req, template)
                }

                // do not modify the template source
                template = typeof renderedTemplate === 'string' ? renderedTemplate : template

                // send back the rendered page
                return send(req, res, template, 'html', {
                  headers: server.config.server.headers
                })
              } catch (e) {
                return next(e)
              }
            }
          }

          next()
        })
      }
    },

    async buildStart() {
      if (!generateSSRBuild) {
        return
      }

      info(console, 'SSR build', `generating the SSR target...`)

      if (resolvedConfig.build.write) {
        prepareOutDir(path.resolve(resolvedConfig.root, resolvedConfig.build.outDir), emptyOutDir, resolvedConfig)
      }

      const outDir = path.resolve(
        // resolve the out dir from the config
        path.resolve(resolvedConfig.root, resolvedConfig.build.outDir),

        // use the public directory name as the out dir
        path.basename(/*options?.clientDir ||*/ resolvedConfig.publicDir || 'www')
      )

      await build({
        configFile: resolvedConfig.configFile,
        build: {
          outDir,
          ssr: false,
          ssrManifest: true
        }
      })

      let template: string | undefined
      let ssrManifest: string | undefined

      // get the ssr manifest file name
      const ssrManifestFile = path.resolve(outDir, 'ssr-manifest.json')

      // get the index html file name
      const input: unknown = resolvedConfig.build.rollupOptions?.input || 'index.html'

      // only accept .html files as a template
      const templateFile =
        typeof input === 'string' && input.endsWith('.html') ? path.resolve(outDir, input) : undefined

      // read the ssr manifest
      if (ssrManifestFile && fs.existsSync(ssrManifestFile)) {
        ssrManifest = fs.readFileSync(ssrManifestFile, 'utf-8')
        fs.unlinkSync(ssrManifestFile)

        manifestSource = JSON.parse(ssrManifest)
        await applyManifestTransformation()

        if (options?.writeManifest !== false) {
          const fn = path.basename(ssrManifestFile)
          fs.writeFileSync(path.resolve(resolvedConfig.root, resolvedConfig.build.outDir, fn), JSON.stringify(manifestSource, null, 2), 'utf-8')
        }
      }

      // read the template
      if (templateFile && fs.existsSync(templateFile)) {
        template = fs.readFileSync(templateFile, 'utf-8')
        fs.unlinkSync(templateFile)

        templateSource = template
        await applyTemplateTransformation()

        if (options?.writeManifest !== false) {
          const fn = path.basename(templateFile)
          fs.writeFileSync(path.resolve(resolvedConfig.root, resolvedConfig.build.outDir, fn), templateSource, 'utf-8')
        }
      }
    }
  }
}
