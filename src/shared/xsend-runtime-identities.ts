// Reviewed CLI compatibility identities; implementation and profile offsets live in the private runtime.
export const XSEND_V3_WECHAT_BUILD = '269631'

export const XSEND_V3_RUNTIME_PROFILES = [
  {
    id: 'resources-4.29.63',
    displayName: '微信 Resources 4.29.63',
    statusMessage: 'xsend 资源与当前微信版本匹配',
    sha256: '964f653977f7e6d00400804eb492e230528c8e8e0653db6300e9b913e49973a9'
  },
  {
    id: 'magicdy-825-4.29.83',
    displayName: 'Magicdy 825 / 4.29.83',
    statusMessage: 'xsend 已匹配 Magicdy 825 运行时',
    sha256: 'f7d40730a6d8c40d370f656e14e0747f919ca3fc23af725d2623324df2053daf'
  },
  {
    id: 'magicdy-874',
    displayName: 'Magicdy 874',
    statusMessage: 'xsend 已匹配 Magicdy 874 运行时',
    sha256: '9fafc1be9bd8d434e36d348d26a2994863964a50eda8781a9a38c2505184dd75'
  }
] as const

export type XsendV3RuntimeProfileId = (typeof XSEND_V3_RUNTIME_PROFILES)[number]['id']

export const XSEND_V3_RUNTIME_PROFILE_MANIFEST = XSEND_V3_RUNTIME_PROFILES.map(
  (profile) => `${profile.id}:${profile.sha256}`
).join(',')
