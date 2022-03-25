// @ts-check
import packageJson from './package.json'
import typescript from '@rollup/plugin-typescript'
import packageJsonPlugin from 'rollup-plugin-generate-package-json'
import copy from 'rollup-plugin-copy'

function output({ format }) {
  const extension = format === 'esm' ? '.mjs' : '.js'

  return {
    chunkFileNames: '[hash]' + extension,
    entryFileNames: '[name]' + extension,
    dir: './dist',
    preferConst: true,
    exports: 'default',
    interop: false,
    externalLiveBindings: false,
    sourcemap: false,
    esModule: false,
    indent: false,
    freeze: false,
    strict: false,
    format
  }
}

export default {
  input: ['src/index.ts', 'src/minify.ts'],

  plugins: [
    typescript(),
    // copy({
    //   targets: [
    //     {
    //       src: 'src/**/*',
    //       dest: 'dist/src'
    //     }
    //   ]
    // }),
    packageJsonPlugin({
      baseContents: {
        name: packageJson.name,
        version: packageJson.version,
        license: packageJson.license,
        main: 'index.js',
        module: 'index.mjs',
        types: 'index.d.ts',
        // source: 'src/index.ts',
        // typescript: 'src/index.ts',
        exports: {
          './package.json': './package.json',
          '.': {
            require: `./index.js`,
            import: `./index.mjs`,
            types: `./index.d.ts`,
            // source: `./src/index.ts`,
            // typescript: `./src/index.ts`
          },
          './minify': {
            require: `./minify.js`,
            import: `./minify.mjs`,
            types: `./minify.d.ts`,
            // source: `./src/minify.ts`,
            // typescript: `./src/minify.ts`
          }
        },
        peerDependencies: {
          chalk: packageJson.devDependencies.chalk,
          vite: packageJson.devDependencies.vite
        },
        optionalDependencies: {
          'html-minifier-terser': packageJson.devDependencies['html-minifier-terser']
        }
      }
    })
  ],

  output: [output({ format: 'cjs' }), output({ format: 'esm' })],

  external: ['fs', 'path', 'http'].concat(Object.keys(packageJson.devDependencies))
}
