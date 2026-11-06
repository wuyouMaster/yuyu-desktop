const { copyFileSync, existsSync, mkdirSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const { signMacosBundle } = require('./sign-macos-bundle.cjs')
const { verifyFfmpegLicense } = require('./check-ffmpeg-license.cjs')
const asar = require(
  require.resolve('@electron/asar', { paths: [require.resolve('electron-builder')] })
)
module.exports = async function (context) {
  const resources =
    context.electronPlatformName === 'darwin'
      ? path.join(
          context.appOutDir,
          context.packager.appInfo.productFilename + '.app',
          'Contents',
          'Resources'
        )
      : path.join(context.appOutDir, 'resources')
  if (!existsSync(path.join(resources, 'skill/yuyu-reader/SKILL.md')))
    throw new Error('Bundled Reader Skill missing')
  if (!existsSync(path.join(resources, 'NOTICE.md')))
    throw new Error('Bundled attribution notice missing')
  const archive = path.join(resources, 'app.asar'),
    files = new Set(asar.listPackage(archive).map((entry) => entry.replaceAll('\\', '/')))
  for (const item of [
    'out/main/index.js',
    'out/main/runtimeRpcWorker.js',
    'out/preload/index.js',
    'build/icon.png'
  ])
    if (!files.has('/' + item)) throw new Error('Packaged application file missing: ' + item)
  const manifest = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'))
  for (const dependency of Object.keys(manifest.dependencies || {}))
    if (!files.has('/node_modules/' + dependency + '/package.json'))
      throw new Error('Production dependency missing: ' + dependency + '; package with pnpm 7.33.7')
  const prohibited = [...files].filter(
    (p) =>
      /^\/(tools|services|docs|\.git|\.env)(\/|$)/.test(p) ||
      /(wechat-storage-host|telegram-storage-host|xkey_helper|xsend-v3-resident|libwx[^/]*\.dylib)$/.test(
        p
      )
  )
  if (prohibited.length) throw new Error('Private runtime entered application package')
  const platform = context.electronPlatformName,
    arch = context.arch === 3 ? 'arm64' : context.arch === 1 ? 'x64' : undefined
  if (!arch) throw new Error('Unverified packaging architecture')
  const unpacked = path.join(resources, 'app.asar.unpacked', 'node_modules')
  const required = ['ffmpeg-static/' + (platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')]
  if (platform === 'darwin' || platform === 'win32') {
    const ocr = platform + '-' + arch + (platform === 'win32' ? '-msvc' : '')
    required.push('@napi-rs/system-ocr-' + ocr + '/system-ocr.' + ocr + '.node')
    required.push(
      'sherpa-onnx-' + (platform === 'win32' ? 'win' : platform) + '-' + arch + '/sherpa-onnx.node'
    )
  }
  for (const file of required)
    if (!existsSync(path.join(unpacked, file)))
      throw new Error('Native package dependency missing: ' + file)
  if (platform !== process.platform)
    throw new Error('FFmpeg validation requires building on the target platform')
  if (platform === 'darwin' && arch === 'arm64') {
    const project = path.join(__dirname, '..')
    const stage = path.join(project, '.tmp', 'public-ffmpeg')
    execFileSync('python3', [path.join(project, 'scripts/prepare-public-ffmpeg.py'), 'verify'], {
      cwd: project, stdio: 'inherit'
    })
    copyFileSync(path.join(stage, 'ffmpeg'), path.join(unpacked, required[0]))
    copyFileSync(path.join(stage, 'FFMPEG-LICENSE.md'), path.join(unpacked, 'ffmpeg-static', 'ffmpeg.LICENSE'))
    copyFileSync(path.join(stage, 'FFMPEG-README.md'), path.join(unpacked, 'ffmpeg-static', 'ffmpeg.README'))
    const notice = path.join(resources, 'third-party', 'ffmpeg')
    mkdirSync(notice, { recursive: true })
    for (const name of ['ffmpeg-9.0.2.tar.xz', 'opus-1.5.2.tar.gz', 'COPYING.LGPLv2.1',
      'OPUS-COPYING', 'FFMPEG-LICENSE.md', 'FFMPEG-README.md', 'build.py', 'build.json'])
      copyFileSync(path.join(stage, name), path.join(notice, name))
  }
  verifyFfmpegLicense(path.join(unpacked, required[0]))
  if (platform === 'darwin') {
    signMacosBundle(path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app'))
    console.log('macOS app bundle ad-hoc signature verified')
  }
  console.log('Application package verified: dependencies present; independent runtimes excluded')
}
