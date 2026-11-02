import { NativeModuleSessionRouter } from './native-module-session-router'
import { promises as fs, type Dirent } from 'fs'
import { isAbsolute, join, relative, resolve, sep } from 'path'
import {
  getNativeModuleManifest,
  isNativeModuleId,
  isNativeModuleCallRequest,
  isNativeModuleTargetSupported,
  NATIVE_MODULE_CATALOG,
  NATIVE_MODULE_CONTRACT_VERSION,
  type NativeModuleArch,
  type NativeModuleCallRequest,
  type NativeModuleCallResult,
  type NativeModuleHealth,
  type NativeModuleId,
  type NativeModuleManifest,
  type NativeModulePlatform,
  type NativeModuleRegistration,
  type NativeModuleResolution,
  type NativeModuleStatus,
  type NativeModuleTarget,
  validateNativeModuleOperationInput,
  validateNativeModuleManifest
} from '../../shared/native-modules'

export interface NativeModuleCompatibilityOptions {
  platform?: NativeModulePlatform
  arch?: NativeModuleArch
  moduleRoots?: string[]
}

export interface NativeModuleProvider {
  registration: NativeModuleRegistration
  healthCheck?: (operation?: string) => Promise<NativeModuleHealth>
  invoke?: (operation: string, input: unknown) => Promise<unknown> | unknown
}

export interface NativeModuleBuiltinOptions {
  healthCheck?: (operation?: string) => Promise<NativeModuleHealth>
  invoke?: (operation: string, input: unknown) => Promise<unknown> | unknown
}

const PLATFORM_MAP: Partial<Record<NodeJS.Platform, NativeModulePlatform | undefined>> = {
  aix: undefined,
  android: undefined,
  darwin: 'darwin',
  freebsd: undefined,
  haiku: undefined,
  linux: 'linux',
  openbsd: undefined,
  sunos: undefined,
  win32: 'win32'
}

const ARCH_MAP: Record<string, NativeModuleArch | undefined> = {
  arm64: 'arm64',
  x64: 'x64',
  ia32: 'ia32'
}

function defaultTarget(): NativeModuleTarget {
  const platform = PLATFORM_MAP[process.platform]
  const arch = ARCH_MAP[process.arch]
  if (!platform || !arch)
    throw new Error('Unsupported native module target: ' + process.platform + '/' + process.arch)
  return { platform, arch }
}

function now(): string {
  return new Date().toISOString()
}

function unavailableHealth(message: string): NativeModuleHealth {
  return { availability: 'unavailable', execution: 'unavailable', checkedAt: now(), message }
}

function isInside(root: string, candidate: string): boolean {
  const rootPath = resolve(root)
  const candidatePath = resolve(candidate)
  const child = relative(rootPath, candidatePath)
  return child === '' || (child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child))
}

/**
 * Resolves downloadable module packages without loading a native library.
 * Invokers implement the operation contract as well as manifest/health metadata.
 * Application-port adapters separately normalize these ABI-level results.
 */
export class NativeModuleCompatibilityService {
  private readonly sessions = new NativeModuleSessionRouter()
  private readonly target: NativeModuleTarget
  private readonly moduleRoots: string[]
  private readonly providers = new Map<NativeModuleId, NativeModuleProvider[]>()
  private readonly discoveredProviders = new Set<NativeModuleProvider>()

  constructor(options: NativeModuleCompatibilityOptions = {}) {
    this.target =
      options.platform && options.arch
        ? { platform: options.platform, arch: options.arch }
        : defaultTarget()
    this.moduleRoots = Array.from(
      new Set((options.moduleRoots ?? []).filter(Boolean).map((root) => resolve(root)))
    )
  }

  getTarget(): NativeModuleTarget {
    return this.target
  }

  register(provider: NativeModuleProvider): void {
    const { manifest } = provider.registration
    const errors = validateNativeModuleManifest(manifest)
    if (errors.length > 0) throw new Error('Invalid native module manifest: ' + errors.join('; '))
    const entries = this.providers.get(manifest.id) ?? []
    entries.push(provider)
    this.providers.set(manifest.id, entries)
  }

  registerBuiltin(manifest: NativeModuleManifest, options: NativeModuleBuiltinOptions = {}): void {
    this.register({
      registration: { manifest, source: 'builtin-fallback' },
      healthCheck: options.healthCheck,
      invoke: options.invoke
    })
  }

  /** Revoke new work, retaining the owner solely for cleanup of its existing sessions. */
  unregister(provider: NativeModuleProvider): boolean {
    const id = provider.registration.manifest.id
    const entries = this.providers.get(id) ?? []
    if (!entries.includes(provider)) return false
    this.sessions.revoke(provider)
    this.providers.set(
      id,
      entries.filter((entry) => entry !== provider)
    )
    this.discoveredProviders.delete(provider)
    return true
  }

  async discoverDownloadedModules(): Promise<NativeModuleStatus[]> {
    for (const provider of this.discoveredProviders) this.sessions.revoke(provider)
    for (const [id, providers] of this.providers) {
      this.providers.set(
        id,
        providers.filter((provider) => !this.discoveredProviders.has(provider))
      )
    }
    this.discoveredProviders.clear()
    for (const root of this.moduleRoots) {
      const moduleNames = await this.readDirectories(root)
      for (const moduleEntry of moduleNames) {
        if (!moduleEntry.isDirectory() || !isNativeModuleId(moduleEntry.name)) continue
        const moduleRoot = join(root, moduleEntry.name)
        const versionNames = await this.readDirectories(moduleRoot)
        for (const versionEntry of versionNames) {
          if (!versionEntry.isDirectory()) continue
          const packageRoot = join(moduleRoot, versionEntry.name)
          try {
            const manifestPath = await this.containedFile(packageRoot, 'module.json')
            if (!manifestPath) continue
            const parsed: unknown = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
            const errors = validateNativeModuleManifest(parsed)
            if (errors.length > 0) continue
            const manifest = parsed as NativeModuleManifest
            if (manifest.id !== moduleEntry.name || manifest.version !== versionEntry.name) continue
            const provider: NativeModuleProvider = {
              registration: { manifest, source: 'downloaded-binary', packageRoot },
              healthCheck: async () => this.checkPackageHealth(manifest, packageRoot)
            }
            this.register(provider)
            this.discoveredProviders.add(provider)
          } catch {
            // A broken optional package must not prevent other modules from loading.
          }
        }
      }
    }
    return this.list()
  }

  async resolve(id: NativeModuleId): Promise<NativeModuleResolution> {
    const selected = await this.selectProvider(id)
    if (selected) {
      const { candidate } = selected
      return {
        id,
        availability: selected.health.availability,
        execution: selected.health.execution,
        source: candidate.registration.source,
        manifest: candidate.registration.manifest,
        packageRoot: candidate.registration.packageRoot,
        capabilityExecution: selected.health.capabilityExecution,
        reason:
          candidate.registration.source === 'research-tool'
            ? 'C tool capability is registered, but no native execution adapter is loaded'
            : selected.health.execution === 'inspected'
              ? 'Package entrypoints are present, but no native execution adapter is registered'
              : selected.health.message
      }
    }
    const candidates = this.providers.get(id) ?? []
    if (candidates.length > 0) {
      const candidate = candidates[0]
      const health = await this.providerHealth(candidate)
      return {
        id,
        availability: health.availability === 'incompatible' ? 'incompatible' : 'unavailable',
        execution: health.execution,
        source: candidate.registration.source,
        manifest: candidate.registration.manifest,
        packageRoot: candidate.registration.packageRoot,
        capabilityExecution: health.capabilityExecution,
        reason: health.message ?? 'No healthy provider is available'
      }
    }
    const manifest = getNativeModuleManifest(id)
    return {
      id,
      availability: isNativeModuleTargetSupported(manifest, this.target)
        ? 'unavailable'
        : 'incompatible',
      execution: 'unavailable',
      manifest,
      reason: isNativeModuleTargetSupported(manifest, this.target)
        ? 'No provider is registered'
        : 'The catalog does not support ' + this.target.platform + '/' + this.target.arch
    }
  }

  async invoke<T = unknown>(request: NativeModuleCallRequest): Promise<NativeModuleCallResult<T>> {
    if (!isNativeModuleCallRequest(request)) throw new Error('Invalid native module call request')
    const manifest = getNativeModuleManifest(request.id)
    if (!manifest.capabilities.includes(request.operation)) {
      throw new Error('Operation ' + request.operation + ' is not declared by ' + request.id)
    }
    const inputErrors = validateNativeModuleOperationInput(
      request.id,
      request.operation,
      request.input
    )
    if (inputErrors.length > 0) throw new Error(inputErrors.join('; '))
    const { provider, value } = await this.sessions.invoke(
      request,
      async () => {
        const selected = await this.selectProvider(request.id, true, request.operation)
        if (!selected?.candidate.invoke) {
          const resolution = await this.resolve(request.id)
          throw new Error(resolution.reason ?? 'No executable provider for ' + request.operation)
        }
        return selected.candidate
      },
      async (candidate, operation) => {
        if (!this.providers.get(request.id)?.includes(candidate)) return false
        const health = await this.providerHealth(candidate, operation)
        return (
          health.availability === 'available' &&
          health.execution === 'ready' &&
          (health.capabilityExecution?.[operation] ?? 'ready') === 'ready'
        )
      }
    )
    return {
      id: request.id,
      operation: request.operation,
      source: provider.registration.source,
      value: value as T
    }
  }

  async list(): Promise<NativeModuleStatus[]> {
    const result: NativeModuleStatus[] = []
    for (const manifest of NATIVE_MODULE_CATALOG) {
      const resolution = await this.resolve(manifest.id)
      result.push({
        ...resolution,
        capabilities: manifest.capabilities,
        dependencies: manifest.dependencies
      })
    }
    return result
  }

  private async checkPackageHealth(
    manifest: NativeModuleManifest,
    packageRoot: string
  ): Promise<NativeModuleHealth> {
    if (manifest.contractVersion !== NATIVE_MODULE_CONTRACT_VERSION) {
      return unavailableHealth('Module contract version is incompatible')
    }
    if (manifest.entrypoints.length === 0) return unavailableHealth('No entrypoints declared')
    for (const entrypoint of manifest.entrypoints) {
      const entrypointPath = await this.resolveEntrypointPath(packageRoot, entrypoint.path)
      if (!entrypointPath) {
        return unavailableHealth('Missing entrypoint: ' + entrypoint.path)
      }
    }
    return {
      availability: 'available',
      execution: 'inspected',
      checkedAt: now(),
      details: { entrypoints: manifest.entrypoints.length }
    }
  }

  private async resolveEntrypointPath(
    packageRoot: string,
    entrypoint: string
  ): Promise<string | null> {
    const suffixes =
      this.target.platform === 'win32'
        ? ['.dll', '.exe', '']
        : this.target.platform === 'darwin'
          ? ['.dylib', '', '.so']
          : ['.so', '', '.so.1']
    for (const suffix of suffixes) {
      const candidate = await this.containedFile(packageRoot, entrypoint + suffix)
      if (candidate) return candidate
    }
    return null
  }

  private async readDirectories(root: string): Promise<Dirent[]> {
    try {
      return (await fs.readdir(root, { withFileTypes: true })).filter((entry) =>
        entry.isDirectory()
      )
    } catch {
      return []
    }
  }

  private async containedFile(packageRoot: string, path: string): Promise<string | null> {
    try {
      const root = await fs.realpath(packageRoot)
      const candidate = await fs.realpath(join(packageRoot, path))
      return isInside(root, candidate) && (await fs.stat(candidate)).isFile() ? candidate : null
    } catch {
      return null
    }
  }

  private async providerHealth(
    candidate: NativeModuleProvider,
    operation?: string
  ): Promise<NativeModuleHealth> {
    if (!isNativeModuleTargetSupported(candidate.registration.manifest, this.target)) {
      return {
        availability: 'incompatible',
        execution: 'unavailable',
        checkedAt: now(),
        message: 'Provider does not support ' + this.target.platform + '/' + this.target.arch
      }
    }
    try {
      const health = candidate.healthCheck
        ? await candidate.healthCheck(operation)
        : (candidate.registration.health ?? {
            availability: 'available',
            execution: candidate.invoke ? 'ready' : 'inspected',
            checkedAt: now()
          })
      return {
        ...health,
        capabilityExecution: health.capabilityExecution,
        execution:
          health.availability !== 'available'
            ? 'unavailable'
            : candidate.invoke
              ? health.execution
              : 'inspected'
      }
    } catch {
      return unavailableHealth('Provider health check failed')
    }
  }

  private async selectProvider(
    id: NativeModuleId,
    requireInvoker = false,
    operation?: string
  ): Promise<{ candidate: NativeModuleProvider; health: NativeModuleHealth } | null> {
    const candidates = [...(this.providers.get(id) ?? [])].sort((a, b) => {
      const rank = (source: NativeModuleProvider['registration']['source']): number => {
        if (source === 'bundled-binary') return 4
        if (source === 'downloaded-binary') return 3
        if (source === 'builtin-fallback') return 2
        return 1
      }
      return rank(b.registration.source) - rank(a.registration.source)
    })
    for (const candidate of candidates) {
      if (requireInvoker && !candidate.invoke) continue
      if (operation && !candidate.registration.manifest.capabilities.includes(operation)) continue
      const cleanup =
        operation === 'database.open'
          ? 'database.close'
          : operation === 'database.message_cursor_open'
            ? 'database.message_cursor_close'
            : operation === 'sync.open'
              ? 'sync.close'
              : id === 'xsend-helper' && operation === 'send.create'
                ? 'send.close'
                : undefined
      if (cleanup && !candidate.registration.manifest.capabilities.includes(cleanup)) continue
      const health = await this.providerHealth(candidate, operation)
      if (cleanup) {
        const cleanupHealth = await this.providerHealth(candidate, cleanup)
        if (
          cleanupHealth.availability !== 'available' ||
          cleanupHealth.execution !== 'ready' ||
          (cleanupHealth.capabilityExecution?.[cleanup] ?? 'ready') !== 'ready'
        )
          continue
      }
      const capabilityExecution = operation ? health.capabilityExecution?.[operation] : undefined
      if (
        health.availability === 'available' &&
        (!requireInvoker ||
          (health.execution === 'ready' &&
            (capabilityExecution === undefined || capabilityExecution === 'ready')))
      ) {
        return { candidate, health }
      }
    }
    return null
  }
}

export function createNativeModuleCompatibilityService(
  options: NativeModuleCompatibilityOptions = {}
): NativeModuleCompatibilityService {
  return new NativeModuleCompatibilityService(options)
}
