import type { DatabasePort } from '../../shared/database-port'
import {
  DATABASE_PORT_CAPABILITIES,
  DATABASE_PROTOCOL_VERSION
} from '../../shared/database-capability'
import { CapabilityProviderRegistry } from './capability-provider-registry'

export type { DatabaseProviderRegistration } from '../../shared/database-capability'

export class DatabaseProviderRegistry extends CapabilityProviderRegistry<DatabasePort> {
  constructor(source: string, accountId: string) {
    super(source, accountId, DATABASE_PROTOCOL_VERSION, DATABASE_PORT_CAPABILITIES)
  }
}
