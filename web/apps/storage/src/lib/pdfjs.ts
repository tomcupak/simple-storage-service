import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

/** Imported only through `import('../lib/pdfjs')`, so pdf.js and its worker stay out of the
 *  main bundle until someone opens a PDF. */
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export { pdfjs }
