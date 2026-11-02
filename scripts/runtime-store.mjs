import { createHash, randomUUID } from 'node:crypto'
import { promises as fs, readFileSync, realpathSync, lstatSync } from 'node:fs'
import path from 'node:path'
import unzipper from 'unzipper'

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const MAX_ARCHIVE = 128 * 1024 * 1024
const MAX_UNPACKED = 512 * 1024 * 1024
const safe = (name) =>
  typeof name === 'string' &&
  /^[a-zA-Z0-9_.\/-]+$/.test(name) &&
  !name.startsWith('/') &&
  name.split('/').every((p) => p && p !== '.' && p !== '..')
const assert = (ok, message) => {
  if (!ok) throw new Error(message)
}

export function selectRuntime(catalog, application, version, target) {
  const item = catalog.packages.find(
    (p) => p.application === application && p.version === version && p.target === target
  )
  assert(
    item && /^[a-f0-9]{64}$/.test(item.sha256) && /^[a-f0-9]{40}$/.test(item.sourceCommit),
    '未找到受信任的指定版本或平台'
  )
  assert(
    ['wechat', 'telegram', 'dingtalk'].includes(item.application) && safe(item.version),
    '运行时标识无效'
  )
  return item
}

export async function readActive(home) {
  try {
    return JSON.parse(await fs.readFile(path.join(home, 'active.json'), 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw new Error('运行时安装记录损坏')
  }
}

function packageDirectory(home, item) {
  return path.join(home, 'packages', item.application, item.sha256)
}

export async function verifyRuntime(home, item) {
  const root = packageDirectory(home, item)
  const manifestBytes = await fs.readFile(path.join(root, 'runtime-manifest.json'))
  assert(hash(manifestBytes) === item.manifestSha256, '已安装清单校验失败')
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  validateManifest(manifest, item)
  for (const file of manifest.files) {
    const p = path.join(root, file.path)
    const real = await fs.realpath(p)
    assert(real.startsWith((await fs.realpath(root)) + path.sep), '运行时文件越界')
    const stat = await fs.lstat(p)
    assert(stat.isFile() && !stat.isSymbolicLink(), '运行时文件类型异常')
    const bytes = await fs.readFile(p)
    assert(bytes.length === file.size && hash(bytes) === file.sha256, '运行时文件校验失败')
    if (process.platform !== 'win32')
      assert((stat.mode & 0o777) === file.mode, '运行时文件权限校验失败')
  }
  return root
}

/** Synchronous application ports use the same complete manifest checks before
 * creating their owned worker. The async installer remains the activation owner. */
export function verifyRuntimeSync(home, item) {
  const root = packageDirectory(home, item)
  const manifestBytes = readFileSync(path.join(root, 'runtime-manifest.json'))
  assert(hash(manifestBytes) === item.manifestSha256, '已安装清单校验失败')
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  validateManifest(manifest, item)
  const realRoot = realpathSync(root)
  for (const file of manifest.files) {
    const p = path.join(root, file.path)
    assert(realpathSync(p).startsWith(realRoot + path.sep), '运行时文件越界')
    const stat = lstatSync(p)
    assert(stat.isFile() && !stat.isSymbolicLink(), '运行时文件类型异常')
    const bytes = readFileSync(p)
    assert(bytes.length === file.size && hash(bytes) === file.sha256, '运行时文件校验失败')
    if (process.platform !== 'win32') assert((stat.mode & 0o777) === file.mode, '运行时文件权限校验失败')
  }
  return root
}

function validateManifest(manifest, item) {
  assert(
    manifest.schemaVersion === 1 &&
      manifest.application === item.application &&
      manifest.version === item.version &&
      manifest.target === item.target &&
      manifest.sourceCommit === item.sourceCommit,
    '归档身份与锁定版本不一致'
  )
  assert(
    Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= 1000,
    '文件清单无效'
  )
  const names = new Set()
  let total = 0
  for (const file of manifest.files) {
    assert(
      safe(file.path) &&
        file.path !== 'runtime-manifest.json' &&
        !names.has(file.path.toLowerCase()),
      '归档路径重复或越界'
    )
    names.add(file.path.toLowerCase())
    assert(
      item.files.includes(file.path) &&
        /^[a-f0-9]{64}$/.test(file.sha256) &&
        Number.isSafeInteger(file.size) &&
        file.size >= 0 &&
        [0o644, 0o755].includes(file.mode),
      '文件清单与锁定目录不一致'
    )
    total += file.size
  }
  assert(names.size === item.files.length && total <= MAX_UNPACKED, '归档文件不完整或过大')
}

async function download(url, { token, allowLoopback = false, signal, onProgress } = {}) {
  let current = new URL(url)
  for (let n = 0; n < 5; n++) {
    const loopback = ['127.0.0.1', '[::1]'].includes(current.hostname)
    assert(
      current.protocol === 'https:' || (allowLoopback && loopback && current.protocol === 'http:'),
      '下载只允许 HTTPS；本机测试服务必须显式开启'
    )
    assert(!current.username && !current.password, '下载地址不能包含凭据')
    const headers = { Accept: 'application/octet-stream' }
    // Never forward a GitHub credential to release CDN redirects or arbitrary mirrors.
    if (token && current.hostname === 'api.github.com') headers.Authorization = `Bearer ${token}`
    const response = await fetch(current, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.any([AbortSignal.timeout(120000), ...(signal ? [signal] : [])])
    })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get('location')
      await response.body?.cancel()
      assert(next, '下载重定向缺少地址')
      current = new URL(next, current)
      continue
    }
    assert(
      response.ok,
      response.status === 404
        ? '下载文件不存在，或当前没有访问权限'
        : `下载失败（HTTP ${response.status}）`
    )
    assert(Number(response.headers.get('content-length') || 0) <= MAX_ARCHIVE, '归档超过大小限制')
    const total = Number(response.headers.get('content-length')) || undefined
    onProgress?.({ phase: 'downloading', downloaded: 0, total })
    const chunks = []
    let size = 0
    for await (const chunk of response.body) {
      signal?.throwIfAborted()
      size += chunk.length
      onProgress?.({ phase: 'downloading', downloaded: size, total })
      assert(size <= MAX_ARCHIVE, '归档超过大小限制')
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  }
  throw new Error('下载重定向次数过多')
}

export async function installRuntime({
  home,
  item,
  archive,
  baseUrl,
  downloadUrl,
  token,
  allowLoopback = false,
  signal,
  onProgress
}) {
  signal?.throwIfAborted()
  onProgress?.({ phase: 'connecting', downloaded: 0 })
  if (downloadUrl !== undefined) {
    assert(typeof downloadUrl === 'string' && downloadUrl.length > 0, '下载链接无效')
    let parsed
    try {
      parsed = new URL(downloadUrl)
    } catch {
      throw new Error('下载链接无效')
    }
    assert(
      parsed.protocol === 'https:' && !parsed.username && !parsed.password,
      '自定义下载链接必须为不含账号密码的 HTTPS 地址'
    )
  }
  assert(!(archive && downloadUrl), '离线归档和下载链接不能同时指定')
  await fs.mkdir(home, { recursive: true, mode: 0o700 })
  const guard = path.join(home, 'install.lock')
  let lock
  try {
    lock = await fs.open(guard, 'wx', 0o600)
  } catch {
    throw new Error('已有运行时安装正在执行')
  }
  const stage = path.join(home, '.stage-' + randomUUID())
  try {
    let bytes
    if (archive) bytes = await fs.readFile(archive)
    else {
      let url = downloadUrl ?? item.url
      let downloadToken
      if (baseUrl && !downloadUrl) {
        assert(allowLoopback, '测试下载地址仅允许显式本机测试')
        const base = new URL(baseUrl)
        assert(['127.0.0.1', '[::1]'].includes(base.hostname), '测试下载地址必须是本机回环地址')
        url = new URL(item.asset, base.href.endsWith('/') ? base.href : base.href + '/').href
      }
      if (token && !baseUrl && !downloadUrl && item.githubAuthentication === true) {
        assert(item.repository && item.tag && item.asset, 'GitHub 鉴权下载配置不完整')
        downloadToken = token
        // The private GitHub API resolves an immutable selected asset; token stays main-process only.
        const api = `https://api.github.com/repos/${item.repository}/releases/tags/${encodeURIComponent(item.tag)}`
        const response = await fetch(api, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
          redirect: 'error',
          signal: AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])])
        })
        assert(response.ok, '无法访问指定私有 Release，请核对版本发布状态与只读权限')
        const release = await response.json()
        const asset = release.assets?.find((a) => a.name === item.asset)
        assert(asset && Number.isSafeInteger(asset.id), '指定 Release 不包含目标产物')
        url = `https://api.github.com/repos/${item.repository}/releases/assets/${asset.id}`
      }
      bytes = await download(url, {
        token: downloadToken,
        allowLoopback: allowLoopback && !downloadUrl,
        signal,
        onProgress
      })
    }
    signal?.throwIfAborted()
    onProgress?.({ phase: 'verifying', downloaded: bytes.length, total: bytes.length })
    assert(
      bytes.length <= MAX_ARCHIVE && hash(bytes) === item.sha256,
      '归档 SHA-256 与锁定版本不一致'
    )
    const zip = await unzipper.Open.buffer(bytes)
    assert(zip.files.length <= 1001, '归档文件数量过多')
    const entry = zip.files.find((f) => f.path === 'runtime-manifest.json')
    assert(entry && entry.uncompressedSize <= 1024 * 1024, '缺少有效运行时清单')
    const manifestBytes = await entry.buffer()
    assert(hash(manifestBytes) === item.manifestSha256, '归档清单校验失败')
    const manifest = JSON.parse(manifestBytes.toString('utf8'))
    validateManifest(manifest, item)
    assert(zip.files.length === manifest.files.length + 1, '归档包含清单之外的文件')
    await fs.mkdir(stage, { mode: 0o700 })
    const seen = new Set()
    onProgress?.({ phase: 'extracting', downloaded: bytes.length, total: bytes.length })
    for (const file of zip.files) {
      signal?.throwIfAborted()
      assert(safe(file.path) && !seen.has(file.path.toLowerCase()), '不安全或重复归档路径')
      seen.add(file.path.toLowerCase())
      const unixType = (file.externalFileAttributes >>> 16) & 0o170000
      assert(
        file.type === 'File' && (unixType === 0 || unixType === 0o100000),
        '不允许归档链接或特殊文件'
      )
      const expected = manifest.files.find((f) => f.path === file.path)
      assert(expected || file.path === 'runtime-manifest.json', '清单之外的文件')
      assert(file.uncompressedSize === (expected?.size ?? manifestBytes.length), '归档文件大小异常')
      const data = expected ? await file.buffer() : manifestBytes
      if (expected) assert(hash(data) === expected.sha256, '归档内容校验失败')
      const target = path.join(stage, file.path)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, data, { flag: 'wx', mode: expected?.mode ?? 0o644 })
    }
    signal?.throwIfAborted()
    // Commit is deliberately not cancellable: preserve atomic activation semantics.
    onProgress?.({ phase: 'activating', downloaded: bytes.length, total: bytes.length })
    const destination = packageDirectory(home, item)
    await fs.mkdir(path.dirname(destination), { recursive: true })
    try {
      await fs.rename(stage, destination)
    } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error
      try {
        await verifyRuntime(home, item)
      } catch {
        // Keep corrupt bytes for diagnosis, but never activate or execute them.
        const quarantine = destination + '.invalid-' + randomUUID()
        await fs.rename(destination, quarantine)
        try {
          await fs.rename(stage, destination)
        } catch (replacementError) {
          await fs.rename(quarantine, destination)
          throw replacementError
        }
      }
    }
    await verifyRuntime(home, item)
    const active = await readActive(home)
    active[item.application] = {
      version: item.version,
      sha256: item.sha256,
      target: item.target,
      sourceCommit: item.sourceCommit
    }
    const next = path.join(home, '.active-' + randomUUID())
    await fs.writeFile(next, JSON.stringify(active, null, 2) + '\n', { mode: 0o600 })
    await fs.rename(next, path.join(home, 'active.json'))
    return { application: item.application, version: item.version, sha256: item.sha256 }
  } finally {
    await fs.rm(stage, { recursive: true, force: true })
    await lock.close()
    await fs.unlink(guard)
  }
}
