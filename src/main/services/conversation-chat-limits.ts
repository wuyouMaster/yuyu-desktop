export const CHAT_LIMITS = { modelTimeoutMs: 90_000, totalTimeoutMs: 300_000 }
export type ChatFailureCode =
  | 'model_timeout'
  | 'run_timeout'
  | 'cancelled'
  | 'output_limit'
  | 'provider_error'
export class ChatFailure extends Error {
  constructor(
    readonly code: ChatFailureCode,
    message: string
  ) {
    super(message)
  }
}
