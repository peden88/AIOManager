import { create } from 'zustand'
import localforage from 'localforage'
import { v4 as uuidv4 } from 'uuid'

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
  importGroups: (groups: ManualFailoverGroup[]) => Promise<void>
}

async function persist(groups: ManualFailoverGroup[]) {
  await localforage.setItem(STORAGE_KEY, groups)
  const { useSyncStore } = await import('./syncStore')
  useSyncStore.getState().syncToRemote(true).catch(console.error)
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
      updatedAt: now,
    }
    const groups = existing
      ? get().groups.map(item => item.id === group.id ? group : item)
      : [...get().groups, group]
    set({ groups })
    await persist(groups)
  },
  removeGroup: async (id) => {
    const groups = get().groups.filter(group => group.id !== id)
    set({ groups })
    await persist(groups)
  },
  setMode: async (id, activeMode) => {
    const groups = get().groups.map(group =>
      group.id === id ? { ...group, activeMode, updatedAt: new Date().toISOString() } : group
    )
    set({ groups })
    await persist(groups)
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
      const groups = get().groups.map(item =>
        item.id === id ? { ...item, activeMode: target, updatedAt: new Date().toISOString() } : item
      )
      set({ groups })
      await persist(groups)
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
  },
  importGroups: async (groups) => {
    const safeGroups = Array.isArray(groups) ? groups : []
    set({ groups: safeGroups })
    await localforage.setItem(STORAGE_KEY, safeGroups)
  },
}))
