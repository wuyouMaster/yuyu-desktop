import type { DatabasePort } from './database-port'
import type { CapabilityProvider } from './capability-provider'

export type DatabaseProviderRegistration = CapabilityProvider<DatabasePort>

export const DATABASE_PROTOCOL_VERSION = 1 as const
export type DatabaseCapability = keyof DatabasePort

/** Exhaustive method inventory, independent of the C symbol/operation catalog. */
export const DATABASE_CAPABILITY_METHODS = {
  getSessions: true,
  getSessionsAsync: true,
  getChatTables: true,
  getContactIdentity: true,
  hydrateContactIdentitiesAsync: true,
  getUsernameByMd5: true,
  getAvatarUrlsAsync: true,
  getMyAvatarUrl: true,
  getMyUsernameCandidates: true,
  getMessages: true,
  getMessagesAsync: true,
  listImageMessagesAsync: true,
  countVoiceMessagesAsync: true,
  countImageMessagesAsync: true,
  imageConversationWatermarkAsync: true,
  getGroupMembers: true,
  getGroupMembersAsync: true,
  getGroupMemberIdsAsync: true,
  getGroupMemberNamesAsync: true,
  getGroupMemberIdsBatchAsync: true,
  isGroupMemberIdsBatchAvailable: true,
  getGroupNicknames: true,
  getRoomInfo: true,
  getRoomInfoAsync: true,
  getVoiceData: true,
  getVoiceDataBatch: true,
  getMediaResourceStatus: true,
  listSnsTimeline: true,
  listSnsMessages: true,
  listNonStoreEmoticons: true,
  listEmoticonPackages: true,
  listFMessageItems: true,
  listFavoriteItems: true,
  resolveEmoticonCdnUrl: true,
  resolveImageHardlink: true,
  resolveImageHardlinkAsync: true,
  resolveVideoHardlink: true,
  getAccountRoot: true,
  getKey: true,
  md5: true,
  invalidateSessionCache: true,
  invalidateAvatarCache: true,
  invalidateGroupNicknameCache: true
} as const satisfies Record<DatabaseCapability, true>

export const DATABASE_PORT_CAPABILITIES: readonly DatabaseCapability[] = Object.freeze(
  Object.keys(DATABASE_CAPABILITY_METHODS) as DatabaseCapability[]
)
