import type {
  RuntimeInstallationStatus,
  RuntimeInstallRequest,
  RuntimeInstallProgress
} from '../shared/runtime-installation'
import type { ReadContext } from '../shared/source-context'
import type { DingtalkLocalInspection } from '../shared/dingtalk-local'
import type { TelegramLocalInspection } from '../shared/telegram-local'
import type { TelegramMacOSInspection, TelegramMacOSConnection } from '../shared/telegram-macos'
import type {
  TelegramHistoryRequest,
  TelegramHistoryResult,
  TelegramHistoryQueueRequest,
  TelegramHistoryQueueStatus,
  TelegramMediaLoadRequest
} from '../shared/telegram-history'
import type { PriorityWatchRequest, PriorityWatchPage } from '../shared/priority-watch'
import type { ConversationChatRequest, ConversationChatResult } from '../shared/conversation-chat'
import type {
  ConversationQuery,
  MessageAroundQuery,
  MessageQuery,
  MessagesAroundPage,
  Page,
  ProviderSnapshot,
  SendRequest,
  SendResult,
  SaveAssetResult
} from '../shared/data-source'
import type {
  Account as UnifiedAccount,
  Asset as UnifiedAsset,
  Conversation as UnifiedConversation,
  Membership as UnifiedMembership,
  Message as UnifiedMessage,
  Participant as UnifiedParticipant
} from '../shared/domain-entities'
import type { EntityId } from '../shared/entity-id'
import type {
  NativeModuleCallRequest,
  NativeModuleCallResult,
  NativeModuleId,
  NativeModuleResolution,
  NativeModuleStatus
} from '../shared/native-modules'
import { ElectronAPI } from '@electron-toolkit/preload'
import { Contact, Message, MessagesAroundResult } from '../shared/types'
import { GroupReportExportRequest, GroupReportExportResult } from '../shared/group-report'
import type {
  InstalledReportTemplate,
  ReportTemplateOperationResult
} from '../shared/report-template-package'
import type {
  ReportTemplateCatalogInstallResult,
  ReportTemplateCatalogResult
} from '../shared/report-template-market'
import { LocalApiTestRequest, LocalApiTestResponse } from '../shared/local-api-test'
import {
  DeleteGeneratedReportResult,
  ReportHistoryResult,
  SaveGeneratedReportRequest,
  SaveGeneratedReportResult,
  UpdateGeneratedReportTemplateRequest,
  UpdateGeneratedReportTemplateResult
} from '../shared/report-history'
import type {
  DatabaseKeyEnvironment,
  DatabaseInitResult,
  DatabaseKeyStorageResult,
  DatabaseKeyValidationResult,
  AccountDiscoveryResult
} from '../shared/database-key'
import type {
  ImageDecoderSelectionResult,
  ImageDecoderStatus,
  ImageDecryptionStatus,
  ImageDecryptionTestResult,
  ImageKeyConfigResult,
  SaveImageKeyRequest,
  TestImageDecryptionRequest
} from '../shared/image-decryption'
import type {
  AIChatRequestOptions,
  AiSearchExternalAuthorizationRequest,
  AiSearchExternalAuthorizationResult,
  AiSearchProviderStatus,
  AIConnectionTestResult,
  AIProviderConfig,
  AIProviderListResult,
  AIRuntimeModelConfig,
  AIVisionRuntimeConfig,
  AIVisionTestRequest,
  AIVisionTestResult
} from '../shared/ai-provider'
import type {
  ImageAnalysisRequest,
  ImageAnalysisResponse,
  ImageCandidate,
  ImageCandidateQuery,
  ImageInsight
} from '../shared/image-insight'
import type { SystemOcrCapability, SystemOcrRequest, SystemOcrResult } from '../shared/system-ocr'
import type {
  ImageTextIndexCountResult,
  ImageTextIndexRepairResult,
  ImageTextIndexStartOptions,
  ImageTextIndexStatus
} from '../shared/image-text-index'
import type { AgentHubActionResult, AgentHubLogEntry, AgentHubStatus } from '../shared/agent-hub'
import type {
  AgentHubConversation,
  AgentHubConversationMessage,
  AgentHubConversationSummary
} from '../shared/agent-hub-conversation'
import type {
  PersonalWechatGeneratedTtsVoiceRequest,
  PersonalWechatGeneratedTtsVoiceResult,
  PersonalWechatSendRequest,
  PersonalWechatSendResult,
  PersonalWechatSenderStatus,
  PersonalWechatVoiceDiagnostic
} from '../shared/personal-wechat'
import type { PersonalWechatSendCapability } from '../shared/personal-wechat'
import type {
  ScheduledReportCreateInput,
  ScheduledReportExecution,
  ScheduledReportNotificationSettings,
  ScheduledReportNotificationSettingsResult,
  ScheduledReportResult,
  ScheduledReportTask,
  ScheduledReportUpdateInput
} from '../shared/scheduled-report'
import type {
  PersonalWechatRuntimeDownloadResult,
  PersonalWechatRuntimeProgressEvent,
  PersonalWechatRuntimeStatus
} from '../shared/personal-wechat-runtime'
import type {
  PersonalWechatVoiceEncodingEnvironment,
  PersonalWechatVoiceEncodingEnvironmentResult
} from '../shared/personal-wechat-voice-runtime'
import type { AppLogEntry } from '../shared/app-log'
import type { GroupExitMonitorState } from '../shared/group-exit-monitor'
import type { ActionLogEntry } from '../shared/action-log'
import type {
  AppUpdateCheckResult,
  AppUpdateInstallResult,
  AppUpdateOpenDownloadPageResult,
  AppUpdateState
} from '../shared/app-update'
import type { CacheClearScope, CacheSummary } from '../shared/cache'
import type { ExportRequest, ExportJobProgress, ExportResult } from '../shared/export'
import type {
  VoiceBatchPreflight,
  VoiceBatchConversationSummary,
  VoiceBatchProgress,
  VoiceBatchRequest,
  VoiceMessageReference,
  VoiceModelDownloadResult,
  VoiceModelProgressEvent,
  VoiceModelStatus,
  VoiceRecognitionResult,
  VoiceTranscriptSnapshot
} from '../shared/voice-recognition'
import type {
  AiSearchCancelResult,
  AiSearchPipelineRequest,
  AiSearchPipelineResult,
  AiSearchProgressEvent
} from '../shared/ai-search'
import type {
  AskWechatConfig,
  AskWechatQueryRequest,
  AskWechatQueryResult,
  QueryAgentProgressEvent
} from '../shared/query-agent'
import type {
  KnowledgeRuntimeStatus,
  KnowledgeSearchIpcRequest,
  KnowledgeSearchIpcResult
} from '../shared/knowledge'
import type {
  PublishWechatShareCardRequest,
  PublishWechatShareCardResult,
  WechatShareServiceConfig,
  WechatShareServiceConfigResult
} from '../shared/wechat-share-card'
import type {
  ListTextToSpeechVoicesRequest,
  ListTextToSpeechVoicesResult,
  SaveTextToSpeechSettingsRequest,
  SynthesizeTextToSpeechRequest,
  SynthesizeTextToSpeechResult,
  TextToSpeechSettingsResult
} from '../shared/text-to-speech'

export type TransferPaymentInfo = {
  paySubtype?: string
  amountText?: string
  transcationId?: string
  transferId?: string
  invalidTime?: string
  beginTransferTime?: string
  effectiveDate?: string
  payMemo?: string
  receiverUsername?: string
  payerUsername?: string
  transferStatus?: string
  transferStatusText?: string
}

export type RedPacketPaymentInfo = {
  templateId?: string
  receiveTitle?: string
  sendTitle?: string
  sceneText?: string
  senderDes?: string
  receiverDes?: string
  iconUrl?: string
  nativeUrl?: string
  sendId?: string
  hbType?: string
  hbStatus?: string
  receiveStatus?: string
  redPacketStatusText?: string
}

export type ParsedContent =
  | { type: 'text'; content: string }
  | { type: 'voice'; duration?: number }
  | { type: 'location'; poiname?: string; label?: string; lat: number; lng: number }
  | { type: 'card'; username: string; nickname: string; avatarUrl?: string }
  | {
      type: 'share'
      title: string
      des?: string
      url: string
      appname?: string
      typeVal?: string
      transfer?: TransferPaymentInfo
    }
  | {
      type: 'miniProgram'
      title: string
      description?: string
      appName?: string
      iconUrl?: string
      thumbMd5?: string
      thumbDatName?: string
      thumbDataUrl?: string
    }
  | {
      type: 'redPacket'
      title: string
      description?: string
      url?: string
      pay?: RedPacketPaymentInfo
    }
  | { type: 'voip'; duration?: number; status: string; roomType?: number }
  | { type: 'image'; md5?: string; datName?: string; aeskey?: string; encrypVer?: number }
  | {
      type: 'video'
      md5?: string
      newMd5?: string
      rawMd5?: string
      byteLength?: number
      duration?: number
      width?: number
      height?: number
    }
  | {
      type: 'sticker'
      md5?: string
      url?: string
      thumbUrl?: string
      encryptUrl?: string
      aeskey?: string
    }
  | {
      type: 'quote'
      title?: string
      content?: string
      sender?: string
      quotedContent?: string
      quotedSender?: string
      quotedType?: string
    }
  | { type: 'system'; content: string }
  | { type: 'unknown'; raw: string }

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      restartForRuntime: () => Promise<void>
      getRuntimeInstallProgress: () => Promise<RuntimeInstallProgress | null>
      cancelRuntimeInstall: () => Promise<void>
      listRuntimeInstallations: () => Promise<RuntimeInstallationStatus[]>
      installRuntime: (request: RuntimeInstallRequest) => Promise<void>
      listNativeModules: () => Promise<NativeModuleStatus[]>
      resolveNativeModule: (id: NativeModuleId) => Promise<NativeModuleResolution>
      invokeNativeModule: <T = unknown>(
        request: NativeModuleCallRequest
      ) => Promise<NativeModuleCallResult<T>>
      writeAppLog: (entry: AppLogEntry) => Promise<void>
      getAppLogPath: () => Promise<string>
      revealAppLog: () => Promise<void>
      getAppUpdateState: () => Promise<AppUpdateState>
      checkAppUpdate: () => Promise<AppUpdateCheckResult>
      downloadAppUpdate: () => Promise<AppUpdateCheckResult>
      installAppUpdate: () => Promise<AppUpdateInstallResult>
      openAppUpdateDownloadPage: () => Promise<AppUpdateOpenDownloadPageResult>
      onAppUpdateState: (callback: (state: AppUpdateState) => void) => () => void
      getCacheSummary: () => Promise<CacheSummary>
      clearCache: (scope: CacheClearScope) => Promise<CacheSummary>
      openKnowledgeDirectory: () => Promise<{ success: boolean; error?: string }>
      initDb: (key: string, accountRoot: string) => Promise<boolean | DatabaseInitResult>
      discoverAccounts: (inputPath: string) => Promise<AccountDiscoveryResult>
      getBootstrapCache: () => Promise<{
        self?: { wxid: string; nickname: string; avatar?: string; accountRoot: string }
        contacts: Contact[]
        updatedAt: number
      } | null>
      getStartupCache: () => Promise<{
        self?: { wxid: string; nickname: string; avatar?: string; accountRoot: string }
        contacts: Contact[]
        updatedAt: number
      } | null>
      getContacts: (filter?: string) => Promise<Contact[]>
      getContactAvatars: (
        usernames: string[],
        options?: { refresh?: boolean }
      ) => Promise<Record<string, string>>
      getCachedMessages: (
        userMd5: string,
        startTime?: number,
        endTime?: number
      ) => Promise<Message[]>
      getCachedMessagePage: (
        userMd5: string,
        startTime?: number,
        endTime?: number
      ) => Promise<{
        hit: boolean
        messages: Message[]
        groupSnapshot?: {
          roomId: string
          memberCount: number
          members: {
            wxid: string
            nickname: string
            groupNickname: string
            wechatNickname: string
            remark: string
            avatar: string
          }[]
        }
      }>
      getPriorityWatchPage: (request: PriorityWatchRequest) => Promise<PriorityWatchPage>
      getMessages: (
        userMd5: string,
        startTime?: number,
        endTime?: number,
        options?: { limit?: number }
      ) => Promise<Message[]>
      inspectDingtalkLocalSource: () => Promise<DingtalkLocalInspection>
      inspectTelegramLocalSource: () => Promise<TelegramLocalInspection>
      inspectTelegramMacOSSource: () => Promise<TelegramMacOSInspection>
      connectTelegramMacOSSource: (candidateId: string) => Promise<TelegramMacOSConnection>
      loadTelegramMedia: (request: TelegramMediaLoadRequest) => Promise<UnifiedAsset>
      loadTelegramHistory: (request: TelegramHistoryRequest) => Promise<TelegramHistoryResult>
      startTelegramHistoryQueue: (
        request: TelegramHistoryQueueRequest
      ) => Promise<TelegramHistoryQueueStatus>
      getTelegramHistoryQueue: (
        request: TelegramHistoryQueueRequest
      ) => Promise<TelegramHistoryQueueStatus | undefined>
      cancelTelegramHistoryQueue: (
        request: TelegramHistoryQueueRequest
      ) => Promise<TelegramHistoryQueueStatus>
      connectTelegramLocalSource: (
        slot: number,
        account: string
      ) => Promise<{
        accountId: EntityId
        accountLabel: string
        conversationCount: number
        messageCount: number
      }>
      refreshDingtalkSource: () => Promise<boolean>
      selectTelegramExport: () => Promise<{ canceled: boolean; path?: string }>
      importTelegramSource: (filePath: string) => Promise<{
        accountId: EntityId
        accountLabel: string
        conversationCount: number
        messageCount: number
      }>
      listUnifiedAccounts: () => Promise<Page<UnifiedAccount>>
      listUnifiedConversations: (query?: ConversationQuery) => Promise<Page<UnifiedConversation>>
      listUnifiedParticipants: (
        accountId: EntityId,
        context?: ReadContext
      ) => Promise<Page<UnifiedParticipant>>
      listUnifiedMemberships: (
        conversationId: EntityId,
        context?: ReadContext
      ) => Promise<Page<UnifiedMembership>>
      listUnifiedMessages: (query: MessageQuery) => Promise<Page<UnifiedMessage>>
      listUnifiedMessagesAround: (query: MessageAroundQuery) => Promise<MessagesAroundPage>
      resolveUnifiedAsset: (assetId: EntityId, context?: ReadContext) => Promise<UnifiedAsset>
      saveUnifiedAsset: (assetId: EntityId, context?: ReadContext) => Promise<SaveAssetResult>
      getUnifiedProviderSnapshot: () => Promise<ProviderSnapshot | undefined>
      sendUnifiedMessage: (request: SendRequest) => Promise<SendResult>
      getMessagesAround: (
        userMd5: string,
        messageId: string,
        anchorSeconds?: number,
        radiusSeconds?: number
      ) => Promise<MessagesAroundResult>
      getGroupSnapshot: (userMd5: string) => Promise<{
        roomId: string
        memberCount: number
        members: {
          wxid: string
          nickname: string
          groupNickname: string
          wechatNickname: string
          remark: string
          avatar: string
        }[]
      } | null>
      getGroupExitMonitorState: () => Promise<GroupExitMonitorState>
      setGroupExitMonitorEnabled: (enabled: boolean) => Promise<GroupExitMonitorState>
      setGroupExitMonitorGroups: (
        roomIds: string[],
        notificationRoomIds?: string[]
      ) => Promise<GroupExitMonitorState>
      setGroupExitMonitorNotificationTemplate: (template: string) => Promise<GroupExitMonitorState>
      checkGroupExitMonitorNow: () => Promise<GroupExitMonitorState>
      clearGroupExitMonitorEvents: () => Promise<GroupExitMonitorState>
      resendGroupExitMonitorEvent: (eventId: string) => Promise<GroupExitMonitorState>
      markGroupExitMonitorRead: (readAt?: number) => Promise<GroupExitMonitorState>
      listWechatActionLogs: () => Promise<ActionLogEntry[]>
      onGroupExitMonitorState: (callback: (state: GroupExitMonitorState) => void) => () => void
      search: (keyword: string) => Promise<string | null>
      searchKnowledge: (request: KnowledgeSearchIpcRequest) => Promise<KnowledgeSearchIpcResult>
      runAiSearch: (request: AiSearchPipelineRequest) => Promise<AiSearchPipelineResult>
      cancelAiSearch: (requestId: string) => Promise<AiSearchCancelResult>
      onAiSearchProgress: (callback: (progress: AiSearchProgressEvent) => void) => () => void
      getAskWechatConfig: () => Promise<AskWechatConfig>
      runConversationChat: (request: ConversationChatRequest) => Promise<ConversationChatResult>
      cancelConversationChat: (requestId: string) => Promise<boolean>
      onConversationChatDelta: (callback: (requestId: string, delta: string) => void) => () => void
      runAgentTask: (request: AskWechatQueryRequest) => Promise<AskWechatQueryResult>
      cancelAgentTask: (requestId: string) => Promise<boolean>
      forgetAgentSession: (scope: AskWechatQueryRequest['scope']) => Promise<void>
      runAskWechatQuery: (request: AskWechatQueryRequest) => Promise<AskWechatQueryResult>
      onAskWechatProgress: (
        callback: (requestId: string, event: QueryAgentProgressEvent) => void
      ) => () => void
      forgetAskWechatConversation: () => Promise<void>
      getKnowledgeStatus: () => Promise<KnowledgeRuntimeStatus>
      startKnowledgeIndex: () => Promise<KnowledgeRuntimeStatus>
      cancelKnowledgeIndex: () => Promise<{ cancellable: boolean; cancelled: boolean }>
      onKnowledgeStatus: (callback: (status: KnowledgeRuntimeStatus) => void) => () => void
      aiChat: (
        messages: { role: string; content: string }[],
        options?: AIChatRequestOptions
      ) => Promise<{
        success: boolean
        data?: string
        finishReason?: string
        usage?: {
          input?: number
          output?: number
          total?: number
          estimated?: boolean
        }
        error?: string
      }>
      listAIProviders: () => Promise<AIProviderListResult>
      getAIRuntimeConfig: () => Promise<AIRuntimeModelConfig>
      getAIVisionRuntimeConfig: () => Promise<AIVisionRuntimeConfig>
      getAiSearchProviderStatus: () => Promise<AiSearchProviderStatus>
      authorizeAiSearchExternalProvider: (
        request: AiSearchExternalAuthorizationRequest
      ) => Promise<AiSearchExternalAuthorizationResult>
      saveAIProvider: (provider: AIProviderConfig) => Promise<AIProviderListResult>
      deleteAIProvider: (providerId: string) => Promise<AIProviderListResult>
      setDefaultAIProvider: (providerId: string) => Promise<AIProviderListResult>
      testAIProvider: (providerId: string) => Promise<AIConnectionTestResult>
      testAIVision: (request: AIVisionTestRequest) => Promise<AIVisionTestResult>
      getTextToSpeechSettings: () => Promise<TextToSpeechSettingsResult>
      saveTextToSpeechSettings: (
        request: SaveTextToSpeechSettingsRequest
      ) => Promise<TextToSpeechSettingsResult>
      listTextToSpeechVoices: (
        request?: ListTextToSpeechVoicesRequest
      ) => Promise<ListTextToSpeechVoicesResult>
      synthesizeTextToSpeech: (
        request: SynthesizeTextToSpeechRequest
      ) => Promise<SynthesizeTextToSpeechResult>
      removeGeneratedTextToSpeechAudio: (
        filePath: string
      ) => Promise<{ success: boolean; error?: string }>
      openFishAudioApiKeys: () => Promise<{ success: boolean; error?: string }>
      copyImage: (base64String: string) => Promise<{ success: boolean; error?: string }>
      getVoiceData: (
        sessionId: string,
        localId: number,
        createTime: number,
        svrId?: string | number
      ) => Promise<{ success: boolean; data?: string; error?: string }>
      showVoiceSourceContextMenu: (
        reference: VoiceMessageReference
      ) => Promise<{ success: boolean; error?: string }>
      getVoiceModelStatus: () => Promise<VoiceModelStatus>
      downloadVoiceModel: () => Promise<VoiceModelDownloadResult>
      cancelVoiceModelDownload: () => Promise<{ success: boolean }>
      removeVoiceModel: () => Promise<VoiceModelStatus>
      openVoiceModelDirectory: () => Promise<{ success: boolean; error?: string }>
      recognizeVoice: (
        reference: VoiceMessageReference,
        options?: { force?: boolean }
      ) => Promise<VoiceRecognitionResult>
      getVoiceTranscriptSnapshot: (
        reference: VoiceMessageReference
      ) => Promise<VoiceTranscriptSnapshot>
      cancelVoiceRecognition: (reference: VoiceMessageReference) => Promise<{ success: boolean }>
      getVoiceBatchPreflight: (request: VoiceBatchRequest) => Promise<VoiceBatchPreflight>
      getVoiceBatchConversationSummaries: (
        request: VoiceBatchRequest
      ) => Promise<VoiceBatchConversationSummary[]>
      getVoiceBatchProgress: () => Promise<VoiceBatchProgress | undefined>
      startVoiceBatch: (request: VoiceBatchRequest) => Promise<VoiceBatchProgress>
      cancelVoiceBatch: () => Promise<{ success: boolean }>
      retryFailedVoiceBatch: () => Promise<VoiceBatchProgress>
      onVoiceBatchProgress: (callback: (progress: VoiceBatchProgress) => void) => () => void
      onVoiceModelProgress: (callback: (status: VoiceModelProgressEvent) => void) => () => void
      parseMessage: (content: string, messageType: number) => Promise<ParsedContent>
      getImage: (
        imageMd5?: string,
        imageDatNameOrThumb?: string | boolean,
        sessionId?: string,
        options?: {
          force?: boolean
          preferThumbnail?: boolean
          priority?: number
          includeData?: boolean
        }
      ) => Promise<{
        success: boolean
        data?: string
        error?: string
        isThumb?: boolean
        filePath?: string
      }>
      getVideo: (
        hashes: string[],
        options?: {
          createTime?: number
          byteLength?: number
          duration?: number
          width?: number
          height?: number
        }
      ) => Promise<{ success: boolean; url?: string; poster?: string; error?: string }>
      getSticker: (
        cdnUrl?: string,
        md5?: string,
        options?: { encryptUrl?: string; aeskey?: string }
      ) => Promise<{
        success: boolean
        data?: string
        error?: string
        failureCode?: import('../shared/sticker').StickerFailureCode
        httpStatus?: number
      }>
      startExport: (request: ExportRequest) => Promise<ExportResult>
      selectExportDirectory: () => Promise<{ canceled: boolean; path?: string }>
      cancelExport: (jobId: string) => Promise<{ success: boolean }>
      revealExport: (path: string) => Promise<{ success: boolean; error?: string }>
      onExportProgress: (callback: (progress: ExportJobProgress) => void) => () => void
      exportGroupReport: (request: GroupReportExportRequest) => Promise<GroupReportExportResult>
      listReportTemplates: () => Promise<InstalledReportTemplate[]>
      installReportTemplate: (packagePath: string) => Promise<ReportTemplateOperationResult>
      uninstallReportTemplate: (
        id: string,
        version: string
      ) => Promise<ReportTemplateOperationResult>
      listReportTemplateCatalog: () => Promise<ReportTemplateCatalogResult>
      installReportTemplateFromCatalog: (
        id: string,
        version: string
      ) => Promise<ReportTemplateCatalogInstallResult>
      listGeneratedReports: () => Promise<ReportHistoryResult>
      saveGeneratedReport: (
        request: SaveGeneratedReportRequest
      ) => Promise<SaveGeneratedReportResult>
      updateGeneratedReportTemplate: (
        request: UpdateGeneratedReportTemplateRequest
      ) => Promise<UpdateGeneratedReportTemplateResult>
      deleteGeneratedReport: (reportId: string) => Promise<DeleteGeneratedReportResult>
      revealGroupReport: (filePath: string) => Promise<{ success: boolean; error?: string }>
      getWechatShareConfig: () => Promise<WechatShareServiceConfigResult>
      saveWechatShareConfig: (
        config: WechatShareServiceConfig
      ) => Promise<WechatShareServiceConfigResult>
      publishWechatShareCard: (
        request: PublishWechatShareCardRequest
      ) => Promise<PublishWechatShareCardResult>
      getSavedDbKey: (accountRoot: string) => Promise<DatabaseKeyStorageResult>
      getDatabaseKeyEnvironment: () => Promise<DatabaseKeyEnvironment>
      readDatabaseKeyClipboard: () => Promise<{
        success: boolean
        value?: string
        error?: string
      }>
      installIntelMacKeyRuntime: () => Promise<{
        success: boolean
        error?: string
        code?: string
      }>
      autoGetDbKey: (
        accountRoot: string,
        options?: { save?: boolean }
      ) => Promise<{
        success: boolean
        key?: string
        error?: string
        code?: string
        saved?: boolean
        warning?: string
      }>
      autoGetImageKey: (options?: { save?: boolean }) => Promise<{
        success: boolean
        xorKey?: number
        aesKey?: string
        verified?: boolean
        error?: string
        imageXorKey?: string
        imageAesKey?: string
        settings?: {
          dbRoot: string
          apiEnabled: boolean
          apiHost: string
          apiPort: number
          imageKeyRoot: string
          ffmpegPath: string
          recallProtectionEnabled: boolean
          debugEnabled: boolean
          autoLogin: boolean
          autoLoginPreferenceSet: boolean
          appearanceTheme: 'system' | 'light' | 'dark'
          compactMode: boolean
          showStartupProgress: boolean
          ttsSelectedVoiceId: string
          ttsModel: import('../shared/text-to-speech').TextToSpeechModel
          personalWechatTextBackend: import('../shared/personal-wechat').PersonalWechatTextBackend
          windowsWechatPort: string
          telegramExportPath?: string
        }
      }>
      getImageKeyConfig: () => Promise<ImageKeyConfigResult>
      getImageDecryptionStatus: () => Promise<ImageDecryptionStatus>
      selectImageDecoder: () => Promise<ImageDecoderSelectionResult>
      getImageDecoderStatus: () => Promise<ImageDecoderStatus>
      openImageDecoderDownload: () => Promise<{ success: boolean; error?: string }>
      saveImageKeyConfig: (request: SaveImageKeyRequest) => Promise<ImageKeyConfigResult>
      testImageDecryption: (
        request: TestImageDecryptionRequest
      ) => Promise<ImageDecryptionTestResult>
      clearImageKeyConfig: () => Promise<{ success: boolean; error?: string }>
      pasteAndSaveDbKey: (
        accountRoot: string
      ) => Promise<{ success: boolean; key?: string; error?: string }>
      saveDbKey: (accountRoot: string, key: string) => Promise<DatabaseKeyStorageResult>
      clearSavedDbKey: (accountRoot: string) => Promise<{ success: boolean; error?: string }>
      onWcdbChange: (callback: (payload: { type: string; json: string }) => void) => () => void
      onDbKeyStatus: (callback: (payload: { message: string }) => void) => () => void
      onImageKeyStatus: (callback: (payload: { message: string }) => void) => () => void
      getSettings: () => Promise<{
        settings: {
          dbRoot: string
          apiEnabled: boolean
          apiHost: string
          apiPort: number
          imageKeyRoot: string
          ffmpegPath: string
          recallProtectionEnabled: boolean
          debugEnabled: boolean
          autoLogin: boolean
          autoLoginPreferenceSet: boolean
          appearanceTheme: 'system' | 'light' | 'dark'
          compactMode: boolean
          showStartupProgress: boolean
          ttsSelectedVoiceId: string
          ttsModel: import('../shared/text-to-speech').TextToSpeechModel
          personalWechatTextBackend: import('../shared/personal-wechat').PersonalWechatTextBackend
          windowsWechatPort: string
          telegramExportPath?: string
        }
        settingsPath: string
      }>
      setSettings: (
        patch: Partial<{
          dbRoot: string
          apiEnabled: boolean
          apiHost: string
          apiPort: number
          imageKeyRoot: string
          ffmpegPath: string
          recallProtectionEnabled: boolean
          debugEnabled: boolean
          autoLogin: boolean
          autoLoginPreferenceSet: boolean
          appearanceTheme: 'system' | 'light' | 'dark'
          compactMode: boolean
          showStartupProgress: boolean
          ttsSelectedVoiceId: string
          ttsModel: import('../shared/text-to-speech').TextToSpeechModel
          personalWechatTextBackend: import('../shared/personal-wechat').PersonalWechatTextBackend
          windowsWechatPort: string
          telegramExportPath?: string
        }>
      ) => Promise<{
        settings: {
          dbRoot: string
          apiEnabled: boolean
          apiHost: string
          apiPort: number
          imageKeyRoot: string
          ffmpegPath: string
          recallProtectionEnabled: boolean
          debugEnabled: boolean
          autoLogin: boolean
          autoLoginPreferenceSet: boolean
          appearanceTheme: 'system' | 'light' | 'dark'
          compactMode: boolean
          showStartupProgress: boolean
          personalWechatTextBackend: import('../shared/personal-wechat').PersonalWechatTextBackend
          windowsWechatPort: string
          telegramExportPath?: string
        }
        settingsPath: string
      }>
      getSelf: () => Promise<
        | {
            ready: true
            info: { wxid: string; nickname: string; avatar?: string; accountRoot: string }
          }
        | { ready: false }
      >
      testConnection: (key: string, accountRoot?: string) => Promise<DatabaseKeyValidationResult>
      reopenWithRoot: (accountRoot: string) => Promise<{
        success: boolean
        error?: string
        info?: { wxid: string; nickname: string; avatar?: string; accountRoot: string }
      }>
      selectDbRoot: () => Promise<{ canceled: boolean; path?: string }>
      openAccountRoot: () => Promise<{ success: boolean; error?: string }>
      disconnectDb: (options?: {
        closeNative?: boolean
      }) => Promise<{ success: boolean; error?: string }>
      apiStatus: () => Promise<{
        running: boolean
        host: string
        port: number
        error?: string
      }>
      apiTokenStatus: () => Promise<import('../shared/local-api-auth').ApiTokenStatus>
      revealApiToken: () => Promise<import('../shared/local-api-auth').ApiTokenRevealResult>
      copyApiToken: () => Promise<import('../shared/local-api-auth').ApiTokenActionResult>
      rotateApiToken: () => Promise<import('../shared/local-api-auth').ApiTokenActionResult>
      apiStart: (
        host?: string,
        port?: number
      ) => Promise<{ running: boolean; host: string; port: number; error?: string }>
      apiStop: () => Promise<{ running: boolean; host: string; port: number; error?: string }>
      apiToggle: (enabled: boolean) => Promise<{
        running: boolean
        host: string
        port: number
        error?: string
      }>
      getReaderSkillStatus: () => Promise<{
        available: boolean
        version?: string
        filePath?: string
        directoryPath?: string
        source: 'development' | 'bundled'
        githubUrl: string
        error?: string
      }>
      readReaderSkill: () => Promise<{ success: boolean; content?: string; error?: string }>
      revealReaderSkill: () => Promise<{ success: boolean; error?: string }>
      openReaderSkillGithub: () => Promise<{ success: boolean; error?: string }>
      testLocalApiRequest: (request: LocalApiTestRequest) => Promise<LocalApiTestResponse>
      copyLocalApiCurl: (
        request: LocalApiTestRequest
      ) => Promise<import('../shared/local-api-test').LocalApiCurlCopyResult>
      copyText: (text: string) => Promise<{ success: boolean; error?: string }>
      // ============================================================
      // AI 图片理解基础设施(ImageInsightService)
      // ============================================================
      imageListCandidates: (query: ImageCandidateQuery) => Promise<{
        success: boolean
        candidates: ImageCandidate[]
        error?: string
      }>
      imageAnalyze: (request: ImageAnalysisRequest) => Promise<ImageAnalysisResponse>
      getImageInsight: (imageHash: string) => Promise<{ success: boolean; insight?: ImageInsight }>
      listImageInsights: (
        sessionId: string,
        limit?: number
      ) => Promise<{ success: boolean; insights: ImageInsight[] }>
      // 本地图片文字识别（System OCR，本地 Runtime，非 AI Provider）
      getSystemOcrCapability: () => Promise<SystemOcrCapability>
      recognizeLocalImageText: (request: SystemOcrRequest) => Promise<SystemOcrResult>
      getImageTextIndexStatus: () => Promise<ImageTextIndexStatus>
      countImageMessages: (sinceMs?: number) => Promise<ImageTextIndexCountResult>
      startImageTextIndex: (
        options?: ImageTextIndexStartOptions
      ) => Promise<{ started: boolean; state: string }>
      pauseImageTextIndex: () => Promise<{ paused: boolean; state: string }>
      resumeImageTextIndex: (
        options?: ImageTextIndexStartOptions
      ) => Promise<{ started: boolean; state: string }>
      cancelImageTextIndex: () => Promise<{ cancellable: boolean; cancelled: boolean }>
      clearImageTextIndex: () => Promise<{ removed: boolean; removedBytes: number }>
      resetImageTextIndexFailures: () => Promise<{ reset: number }>
      repairImageTextIndex: () => Promise<ImageTextIndexRepairResult>
      onImageTextIndexStatus: (callback: (status: ImageTextIndexStatus) => void) => () => void
      getPersonalWechatSenderStatus: () => Promise<PersonalWechatSenderStatus>
      getPersonalWechatSendCapability: () => Promise<PersonalWechatSendCapability>
      getPersonalWechatKeepOneBotProcess: () => Promise<boolean>
      setPersonalWechatKeepOneBotProcess: (keep: boolean) => Promise<boolean>
      checkPersonalWechatSenderStatus: (port?: string) => Promise<PersonalWechatSenderStatus>
      checkPersonalWechatVoiceEncodingEnvironment: () => Promise<PersonalWechatVoiceEncodingEnvironment>
      installPersonalWechatPilk: () => Promise<PersonalWechatVoiceEncodingEnvironmentResult>
      openPersonalWechatVoicePythonDownload: () => Promise<{ success: boolean; error?: string }>
      openPersonalWechatVoiceFfmpegDownload: () => Promise<{ success: boolean; error?: string }>
      getPersonalWechatRuntimeStatus: () => Promise<PersonalWechatRuntimeStatus>
      downloadPersonalWechatRuntime: () => Promise<PersonalWechatRuntimeDownloadResult>
      cancelPersonalWechatRuntimeDownload: () => Promise<{ success: boolean }>
      removePersonalWechatRuntime: () => Promise<PersonalWechatRuntimeStatus>
      openPersonalWechatRuntimeDirectory: () => Promise<{ success: boolean; error?: string }>
      onPersonalWechatRuntimeProgress: (
        callback: (status: PersonalWechatRuntimeProgressEvent) => void
      ) => () => void
      rebindPersonalWechatSender: () => Promise<PersonalWechatSenderStatus>
      sendGeneratedTtsVoice: (
        request: PersonalWechatGeneratedTtsVoiceRequest
      ) => Promise<PersonalWechatGeneratedTtsVoiceResult>
      sendPersonalWechatMessage: (
        request: PersonalWechatSendRequest
      ) => Promise<PersonalWechatSendResult>
      listScheduledReports: () => Promise<ScheduledReportTask[]>
      listScheduledReportExecutions: (taskId?: string) => Promise<ScheduledReportExecution[]>
      getScheduledReportNotificationSettings: () => Promise<ScheduledReportNotificationSettings>
      setScheduledReportNotificationEnabled: (
        enabled: boolean
      ) => Promise<ScheduledReportNotificationSettingsResult>
      createScheduledReport: (
        request: ScheduledReportCreateInput
      ) => Promise<ScheduledReportResult<ScheduledReportTask>>
      updateScheduledReport: (
        taskId: string,
        request: ScheduledReportUpdateInput
      ) => Promise<ScheduledReportResult<ScheduledReportTask>>
      deleteScheduledReport: (
        taskId: string
      ) => Promise<ScheduledReportResult<{ deletedId: string }>>
      setScheduledReportEnabled: (
        taskId: string,
        enabled: boolean
      ) => Promise<ScheduledReportResult<ScheduledReportTask>>
      runScheduledReportNow: (
        taskId: string
      ) => Promise<ScheduledReportResult<ScheduledReportExecution>>
      retryScheduledReportSend: (
        executionId: string
      ) => Promise<ScheduledReportResult<ScheduledReportExecution>>
      testScheduledReportErrorNotification: (
        taskId: string
      ) => Promise<ScheduledReportResult<ScheduledReportExecution>>
      getPersonalWechatVoiceDiagnostic: () => Promise<PersonalWechatVoiceDiagnostic | null>
      getAgentHubStatus: () => Promise<AgentHubStatus>
      getAgentHubLogs: () => Promise<AgentHubLogEntry[]>
      clearAgentHubLogs: () => Promise<void>
      startAgentHubLogin: () => Promise<AgentHubActionResult>
      cancelAgentHubLogin: () => Promise<AgentHubActionResult>
      reconnectAgentHub: () => Promise<AgentHubActionResult>
      disconnectAgentHub: () => Promise<AgentHubActionResult>
      selectAgentHubTestImage: () => Promise<{ canceled: boolean; path?: string }>
      selectSourceSendFile: (
        kind: 'image' | 'audio' | 'file' | 'sticker' | 'album'
      ) => Promise<{ canceled: boolean; path?: string; paths?: string[] }>
      selectDingtalkSendFile: (
        kind: 'image' | 'audio'
      ) => Promise<{ canceled: boolean; path?: string }>
      getAgentHubConversations: () => Promise<AgentHubConversationSummary[]>
      getAgentHubConversation: (userId: string) => Promise<AgentHubConversation | null>
      clearAgentHubConversations: () => Promise<{ success: boolean }>
      onAgentHubConversation: (
        callback: (payload: {
          summary: AgentHubConversationSummary
          message: AgentHubConversationMessage
        }) => void
      ) => () => void
      onAgentHubConversationsCleared: (callback: () => void) => () => void
      onAgentHubStatus: (callback: (status: AgentHubStatus) => void) => () => void
      onAgentHubLog: (callback: (entry: AgentHubLogEntry) => void) => () => void
    }
  }
}
