import chalk from 'chalk'

/**
 * Creates a ready-to-use html minifier based on `html-minifier-terser`
 *
 * @returns A function that returns a promise minifying the HTML `string` value.
 *
 * @example
 * ```ts
 * const minify = minify()
 *
 * const html = await minify(`<!DOCTYPE html>...`)
 * ```
 *
 * @note
 * The default options:
 *
 * ```json
 * {
 *    processScripts: ["application/ld+json"],
 *    collapseBooleanAttributes: true,
 *    collapseInlineTagWhitespace: true,
 *    collapseWhitespace: true,
 *    conservativeCollapse: false,
 *    decodeEntities: true,
 *    includeAutoGeneratedTags: false,
 *    minifyCSS: true,
 *    minifyJS: true,
 *    minifyURLs: true,
 *    preventAttributesEscaping: true,
 *    processConditionalComments: true,
 *    removeAttributeQuotes: false,
 *    removeComments: true,
 *    removeEmptyAttributes: true,
 *    removeOptionalTags: false,
 *    removeRedundantAttributes: true,
 *    removeScriptTypeAttributes: true,
 *    removeStyleLinkTypeAttributes: true,
 *    sortAttributes: true,
 *    sortClassName: true,
 *    useShortDoctype: false,
 *  }
 * ```
 */
export default function minify(): (value: string) => Promise<string> {
  return async function (html: string): Promise<string> {
    let minify

    try {
      minify = (await import('html-minifier-terser')).minify
    } catch {
      console.log(
        chalk.yellow(`'html-minifier-terser' is required for minify the html, the html will not be minified.`)
      )

      return html
    }

    return minify(html, {
      processScripts: ['application/ld+json'],
      collapseBooleanAttributes: true,
      collapseInlineTagWhitespace: true,
      collapseWhitespace: true,
      conservativeCollapse: false, // we do not render anything, so its ok to collapse aggressively
      decodeEntities: true,
      includeAutoGeneratedTags: false,
      minifyCSS: true,
      minifyJS: true,
      minifyURLs: true,
      preventAttributesEscaping: true,
      processConditionalComments: true,
      removeAttributeQuotes: false, // set to true to remove quotes around the attributes
      // ignoreCustomComments: you can use this to set replacement for the template
      removeComments: true, // by default, comments are not needed but it requires <div id=app ... >
      removeEmptyAttributes: true,
      removeOptionalTags: false, // important, since we need to inject into head and body
      removeRedundantAttributes: true,
      removeScriptTypeAttributes: true,
      removeStyleLinkTypeAttributes: true,
      sortAttributes: true,
      sortClassName: true,
      useShortDoctype: false // useless, we always generate HTML5 DOCTYPE
    })
  }
}
