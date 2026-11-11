/** sharp ships CommonJS at runtime (`module.exports = sharp`) but declares its types as an ES
 *  default export, and this repo compiles without `esModuleInterop`, so `import sharp from` would
 *  read `.default` off a function and get `undefined`. Loading it with `require` and borrowing the
 *  declared type keeps the call typed and correct at runtime. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const sharp = require('sharp') as typeof import('sharp').default
