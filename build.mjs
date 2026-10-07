// Tüm uygulamayı tek bir, bağımsız HTML dosyasına (docs/index.html) paketler.
import {build} from 'esbuild'
import {readFile, writeFile, mkdir, cp} from 'node:fs/promises'

const js = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  write: false,
  legalComments: 'none'
})
const css = await build({
  entryPoints: ['src/style.css'],
  bundle: true,
  minify: true,
  write: false
})
const tpl = await readFile('src/index.html', 'utf8')
const out = tpl
  .replace('/*CSS*/', () => css.outputFiles[0].text)
  .replace('/*JS*/', () => js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script'))
await mkdir('docs', {recursive: true})
await writeFile('docs/index.html', out)
// Uygulama simgeleri, manifest ve service worker (yüklenebilir uygulama)
await cp('public', 'docs', {recursive: true})
console.log(`docs/index.html yazıldı (${(out.length / 1024).toFixed(1)} KB)`)
