import type { Organization, OrganizationIdentity } from '../../shared/domain-entities'
import type { EntityId } from '../../shared/entity-id'
import type { IdentityContextProvider, SourceIdentityState } from '../../shared/source-context'

export class DingtalkIdentityContextProvider implements IdentityContextProvider {
  readonly source = 'dingtalk'

  constructor(readonly accountId: EntityId, private readonly revision: string) {}

  async inspectIdentity(): Promise<SourceIdentityState> {
    const organizations: Organization[] = []
    const identities: OrganizationIdentity[] = []
    return {
      revision: this.revision,
      // The native bridge sends through the currently logged-in DingTalk
      // account. Organisation switching is not exposed by this first adapter,
      // so account scope is the only identity we claim.
      activeIdentity: { kind: 'account' },
      organizations,
      identities
    }
  }
}
