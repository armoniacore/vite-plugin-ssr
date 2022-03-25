# @armonia/vite-plugin-ssr [![npm](https://img.shields.io/npm/v/@armonia/vite-plugin-ssr.svg)](https://npmjs.com/package/@armonia/vite-plugin-ssr)

A vite plugin for ssr.

```js
// vite.config.ts
import ssr from '@armonia/vite-plugin-ssr'

export default {
  plugins: [ssr({
    ssr: 'src/entry-server.ts' // set an ssr entry point
  })],
}

// or
export default {
  build : {
    ssr: 'src/entry-server.ts'
  },
  plugins: [ssr()],
}
```

## Example

```js
import ssr from '@armonia/vite-plugin-ssr'
import minify from '@armonia/vite-plugin-ssr/minify'

export default {
  //
  build : {
    ssr: 'src/entry-server.ts'
  },
  plugins: [
    ssr({
      // minify the html after vite has run
      transformTemplate: minify(),

      // overwrite the ssr config when building
      buildConfig: {
        build: {
          // do not minify the output
          minify: false,
          rollupOptions: {
            output: {
              // set the format to esm
              format: 'esm',
            }
          }
        },
      }

    })
  ]
}
```

## Example for building a single file

```js
import ssr from '@armonia/vite-plugin-ssr'

export default {
  build : {
    ssr: 'src/entry-server.ts'
  },
  plugins: [
    ssr({
      buildConfig: {
          // refer to: https://vitejs.dev/config/#ssr-options
          ssr: {
            noExternal: /./
          },

          resolve: {
            // necessary because vue.ssrUtils is only exported on cjs modules
            alias: [
              {
                find: '@vue/runtime-dom',
                replacement: '@vue/runtime-dom/dist/runtime-dom.cjs.js'
              },
              {
                find: '@vue/runtime-core',
                replacement: '@vue/runtime-core/dist/runtime-core.cjs.js'
              }
            ]
          }
        }
    })
  ]
}
```

## Embedded manifest and template

The plugin allow you to import `ssr:manifest` and `ssr:template`

```ts
// server-entry.ts
import manifest from 'ssr:manifest';
import template from 'ssr:template';

// manifest is Record<string, string[]>
// template is string

export async function render (req: http:IncomingMessage) {
  // load req.originalUrl

  const preloadLinks = renderPreloadLinks(..., manifest); // resolved by the plugin

  return template // minified and resolved by the plugin
    .replace('</head>', `${preloadLinks}</head>`)
    .replace('<div id="app"></div>', `<div id="app">${appHtml}</div>`);
}
```

Those imports contains the `index.html` source text and the manifest object `{}`,

Note that the ssr manifest does not exists when developing, so be aware that when you reload the page during development you will see a flash of unstyled content.

Importing the manifest can be especially beneficial when you want to export a single file, by embedding the template and manifest in the source code, you do not need to rely on a file to be present in the output directory, you also do not need a special code to load such files, very handy indeed.

It is advisable that you do not perform a minification each time you run the render function, the plugin allow you to minify the html during the build event.

### Typings

```ts
declare module 'ssr:manifest' {
  const manifest: Record<string, string[]>;
  export default manifest;
}

declare module 'ssr:template' {
  const template: string;
  export default template;
}
```

## Preview the output

As right now, this plugin does not provide a way to preview the output.

The following is an example code that you can use:

Save the text in a file named `preview.js`, at the root of your vite project.

Use `node preview` to run the file thus running the preview server.

Note that you need to build the project first.

```js
// @ts-check
const path = require("path");
const express = require("express");
const compression = require("compression");
const serveStatic = require("serve-static");

async function createServer() {
  // the dist folder
  const root = "dist";

  const resolveRoot = (p) => path.resolve(__dirname, root, p);

  // load the server entry .render is the function you export
  const render = require(resolveRoot("entry-server.js")).render;

  const app = express();
  app.disable("x-powered-by");

  app.use(compression());

  // serve the public dir, by default is www for this plugin
  app.use(
    serveStatic(resolve("www"), {
      index: false,
      maxAge: "365d",
      lastModified: false,
    })
  );

  app.use("*", async (req, res) => {
    try {
      // 1. render the app HTML.
      const html = await render(req);

      // 2. Send the rendered HTML back.
      res.status(200).set({ "Content-Type": "text/html" }).end(html);
    } catch (e) {
      console.error(e);
      res.status(500).end();
    }
  });

  return { app };
}

const PORT = process.env.PORT || 3000;

createServer().then(({ app }) =>
  app.listen(PORT, () => console.log(`Server ready: http://localhost:${PORT}`))
);
```

## Caveats

This plugin requires ssr to be explicitly enabled since vite does not allow the `--ssr` flag on dev.

```js
ssr({ ssr: 'src/entry-server.ts' })
```

When building an ssr target, the plugin will run the build event twice, the first time, on `buildStart` it will build the client in an `outDir` subdirectory named `resolvedConfig.publicDir` or `www`.

It will then build the ssr target as normal.

### Reset options

The plugin will reset the `entryFileNames` when building in production.

`rollupOptions.output.entryFileNames = '[name].js'`

You need to explicitly set this option again in the ssr plugin if you want a custom entry name.

```js
ssr({
  buildConfig: {
    build: {
      rollupOptions: {
        output: {
          entryFileNames: 'server_render.js',
        }
      }
    },
  }
})
```

### Minified in production

You may not want the ssr build to be minified.

```js
ssr({
  ...
  buildConfig: {
    build: {
      minify: false,
    },
  }
  ...
})
```

### Do not generate index.html and ssr-manifest.json

If you plan to use `ssr:manifest` and `ssr:template` in your code, you can also disable the generation of the files with:

```js
ssr({ writeManifest: false })
```

### Disable building

If you do not want this plugin to build automatically, opt out with:

```js
ssr({ buildConfig: false })
```

### Minified template may be different

Be aware that the strategy you choose to inject the content during the ssr need to take into account the fact that the `index.html` file may be minified, especially if you use an option such as `removeAttributeQuotes: true`.

The default minifier included in this plugin is quite aggressive without asking for trouble, it will work out of the box for most projects.

```js
import minify from '@armonia/vite-plugin-ssr/minify'

ssr({
  transformTemplate: minify()
})
```

The following is an example illustrating a problem you may encounter:

```js
// template is minified with removeAttributeQuotes: true, <div id=app>...

// this will not work
template.replace('<div id="app"></div>', `<div id="app">${appHtml}</div>`);

// you need this instead
template.replace('<div id=app></div>', `<div id=app>${appHtml}</div>`);
```

### Flash of unstyled content (FOUC)

This plugin will not resolve the ssr manifest during development, when reloading the page you will likely see a flash of unstyled content.

If you find that unbearable to see, well that's exactly what your users will see when the server fail to serve the static assets, when they have a bad connection, or in the rare case they have one of those pesky browsers...
