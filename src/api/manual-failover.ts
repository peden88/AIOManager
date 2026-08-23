import type { ManualFailoverGroup } from '@/store/manualFailoverStore'
import { decrypt, deriveSyncToken } from '@/lib/crypto'
import { resilientFetch } from '@/lib/api-resilience'

export interface ManualFailoverServerState {
  id: string
  activeMode: 'primary' | 'backup'
  updatedAt: number
}

function getSyncApiContext() {
  return Promise.all([
    import('@/store/syncStore'),
    import('@/store/authStore'),
    import('@/store/accountStore'),
  ]).then(([{ useSyncStore }, { useAuthStore }, { useAccountStore }]) => {
    const { auth, serverUrl } = useSyncStore.getState()
    const encryptionKey = useAuthStore.getState().encryptionKey
    const accounts = useAccountStore.getState().accounts
    const baseUrl = serverUrl || '/api'
    const apiPath = baseUrl.startsWith('http') ? `${baseUrl}/api` : baseUrl
    return { auth, encryptionKey, accounts, apiPath }
  })
}

async function getSyncHeaders(id: string, password: string) {
  return {
    'Content-Type': 'application/json',
    'x-sync-id': id,
    'x-sync-password': await deriveSyncToken(password),
  }
}

export async function syncManualFailoverExecution(
  groups: ManualFailoverGroup[]
): Promise<ManualFailoverServerState[] | null> {
  const { auth, encryptionKey, accounts, apiPath } = await getSyncApiContext()
  if (!auth.isAuthenticated || !auth.id || !auth.password || !encryptionKey) return null

  const executionGroups = await Promise.all(groups.map(async group => {
    const groupAccounts = accounts.filter(account => group.accountIds.includes(account.id))
    const executionAccounts = await Promise.all(groupAccounts.map(async account => ({
      id: account.id,
      name: account.name,
      authKey: await decrypt(account.authKey, encryptionKey),
      addons: Array.isArray(account.addons) ? account.addons : [],
    })))

    return {
      ...group,
      accounts: executionAccounts,
    }
  }))

  const response = await resilientFetch(`${apiPath}/manual-failover/sync`, {
    method: 'POST',
    headers: await getSyncHeaders(auth.id, auth.password),
    body: JSON.stringify({ groups: executionGroups }),
    timeout: 30000,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Manual failover API sync failed (${response.status})`)
  return Array.isArray(data.states) ? data.states : []
}

export async function pullManualFailoverExecutionStates(): Promise<ManualFailoverServerState[] | null> {
  const { auth, apiPath } = await getSyncApiContext()
  if (!auth.isAuthenticated || !auth.id || !auth.password) return null

  const response = await resilientFetch(`${apiPath}/manual-failover/execution-state`, {
    headers: await getSyncHeaders(auth.id, auth.password),
    timeout: 10000,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Manual failover state pull failed (${response.status})`)
  return Array.isArray(data.states) ? data.states : []
}
