import { create } from 'zustand'
import localforage from 'localforage'
import { v4 as uuidv4 } from 'uuid'
import type { ManualFailoverServerState } from '@/api/manual-failover'

const STORAGE_KEY = 'stremio-manager:manual-failover-groups'

export type ManualFailoverMode = 'primary' | 'backup'

export interface ManualFailoverGroup {
  id: string
  name: string
  tag: string
  accountIds: string[]
  primaryUrl: string
  backupUrl: string
  primaryName?: string
  backupName?: string
  homeButtonSlot?: 1 | 2
  activeMode: ManualFailoverMode
  modeUpdatedAt?: string
  updatedAt: string
}

export interface ManualFailoverExecutionResult {
  target: ManualFailoverMode
  succeeded: number
  failed: number
  failures: Array<{ accountId: string; reason: string }>
}

interface ManualFailoverStore {
  groups: ManualFailoverGroup[]
  initialized: boolean
  initialize: () => Promise<void>
  saveGroup: (group: Omit<ManualFailoverGroup, 'id' | 'activeMode' | 'updatedAt'> & { id?: string }) => Promise<void>
  removeGroup: (id: string) => Promise<void>
  setMode: (id: string, activeMode: ManualFailoverMode) => Promise<void>
  runGroup: (id: string, target: ManualFailoverMode) => Promise<ManualFailoverExecutionResult>
  assignHomeButton: (slot: 1 | 2, groupId: string | null) => Promise<void>
  syncExecutionState: () => Promise<void>
  pullExecutionState: () => Promise<void>
  importGroups: (groups: ManualFailoverGroup[]) => Promise<void>
}

async function persist(groups: ManualFailoverGroup[]) {
  await localforage.setItem(STORAGE_KEY, groups)
  const { useSyncStore } = await import('./syncStore')
  useSyncStore.getState().syncToRemote(true).catch(console.error)
}

async function applyServerStates(
  groups: ManualFailoverGroup[],
  states: ManualFailoverServerState[],
) {
  const stateMap = new Map(states.map(state => [state.id, state]))
  let changed = false
  const reconciled = groups.map(group => {
    const serverState = stateMap.get(group.id)
    if (!serverState) return group
    const localTimestamp = Date.parse(group.modeUpdatedAt || group.updatedAt || '') || 0
    if (serverState.updatedAt < localTimestamp) return group
    const serverTimestamp = new Date(serverState.updatedAt).toISOString()
    if (group.activeMode === serverState.activeMode && group.modeUpdatedAt === serverTimestamp) return group
    changed = true
    return { ...group, activeMode: serverState.activeMode, modeUpdatedAt: serverTimestamp }
  })

  if (changed) {
    await localforage.setItem(STORAGE_KEY, reconciled)
  }
  return { groups: reconciled, changed }
}

export const useManualFailoverStore = create<ManualFailoverStore>((set, get) => ({
  groups: [],
  initialized: false,
  initialize: async () => {
    const stored = await localforage.getItem<ManualFailoverGroup[]>(STORAGE_KEY)
    set({ groups: Array.isArray(stored) ? stored : [], initialized: true })
  },
  saveGroup: async (input) => {
    const now = new Date().toISOString()
    const existing = input.id ? get().groups.find(group => group.id === input.id) : undefined
    const group: ManualFailoverGroup = {
      ...input,
      id: input.id || uuidv4(),
      homeButtonSlot: input.homeButtonSlot ?? existing?.homeButtonSlot,
      activeMode: existing?.activeMode || 'primary',
      modeUpdatedAt: input.modeUpdatedAt || existing?.modeUpdatedAt || existing?.updatedAt || now,
      updatedAt: now,
    }
    const groups = existing
      ? get().groups.map(item => item.id === group.id ? group : item)
      : [...get().groups, group]
    set({ groups })
    await persist(groups)
    get().syncExecutionState().catch(error => console.warn('[Manual Failover] API sync failed:', error))
  },
  removeGroup: async (id) => {
    const groups = get().groups.filter(group => group.id !== id)
    set({ groups })
    await persist(groups)
    get().syncExecutionState().catch(error => console.warn('[Manual Failover] API sync failed:', error))
  },
  setMode: async (id, activeMode) => {
    const now = new Date().toISOString()
    const groups = get().groups.map(group =>
      group.id === id ? { ...group, activeMode, modeUpdatedAt: now, updatedAt: now } : group
    )
    set({ groups })
    await persist(groups)
    get().syncExecutionState().catch(error => console.warn('[Manual Failover] API sync failed:', error))
  },
  runGroup: async (id, target) => {
    const group = get().groups.find(item => item.id === id)
    if (!group) throw new Error('Failover group not found')

    const disableUrl = target === 'backup' ? group.primaryUrl : group.backupUrl
    const enableUrl = target === 'backup' ? group.backupUrl : group.primaryUrl
    const { useAccountStore } = await import('./accountStore')
    const swapAddonEnabledState = useAccountStore.getState().swapAddonEnabledState
    const results = await Promise.allSettled(
      group.accountIds.map(accountId => swapAddonEnabledState(accountId, disableUrl, enableUrl))
    )
    const failures = results.flatMap((result, index) => result.status === 'rejected' ? [{
      accountId: group.accountIds[index],
      reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
    }] : [])
    const succeeded = results.length - failures.length

    if (succeeded > 0) {
      const now = new Date().toISOString()
      const groups = get().groups.map(item =>
        item.id === id ? { ...item, activeMode: target, modeUpdatedAt: now, updatedAt: now } : item
      )
      set({ groups })
      await persist(groups)
      get().syncExecutionState().catch(error => console.warn('[Manual Failover] API sync failed:', error))
    }

    return { target, succeeded, failed: failures.length, failures }
  },
  assignHomeButton: async (slot, groupId) => {
    if (groupId && !get().groups.some(group => group.id === groupId)) {
      throw new Error('Failover group not found')
    }

    const now = new Date().toISOString()
    const groups = get().groups.map(group => {
      const shouldAssign = group.id === groupId
      const shouldClear = group.homeButtonSlot === slot || (shouldAssign && group.homeButtonSlot !== slot)
      if (!shouldAssign && !shouldClear) return group
      return {
        ...group,
        homeButtonSlot: shouldAssign ? slot : undefined,
        updatedAt: now,
      }
    })
    set({ groups })
    await persist(groups)
    get().syncExecutionState().catch(error => console.warn('[Manual Failover] API sync failed:', error))
  },
  syncExecutionState: async () => {
    const { syncManualFailoverExecution } = await import('@/api/manual-failover')
    const states = await syncManualFailoverExecution(get().groups)
    if (!states) return
    const reconciled = await applyServerStates(get().groups, states)
    if (reconciled.changed) {
      set({ groups: reconciled.groups })
      const { useSyncStore } = await import('./syncStore')
      useSyncStore.getState().syncToRemote(true).catch(console.error)
    }
  },
  pullExecutionState: async () => {
    const { pullManualFailoverExecutionStates } = await import('@/api/manual-failover')
    const states = await pullManualFailoverExecutionStates()
    if (!states) return
    const reconciled = await applyServerStates(get().groups, states)
    if (reconciled.changed) {
      set({ groups: reconciled.groups })
      const { useSyncStore } = await import('./syncStore')
      useSyncStore.getState().syncToRemote(true).catch(console.error)
    }
  },
  importGroups: async (groups) => {
    const safeGroups = Array.isArray(groups) ? groups : []
    set({ groups: safeGroups })
    await localforage.setItem(STORAGE_KEY, safeGroups)
  },
}))
