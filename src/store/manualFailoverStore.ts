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
  activeMode: ManualFailoverMode
  updatedAt: string
}

interface ManualFailoverStore {
  groups: ManualFailoverGroup[]
  initialized: boolean
  initialize: () => Promise<void>
  saveGroup: (group: Omit<ManualFailoverGroup, 'id' | 'activeMode' | 'updatedAt'> & { id?: string }) => Promise<void>
  removeGroup: (id: string) => Promise<void>
  setMode: (id: string, activeMode: ManualFailoverMode) => Promise<void>
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
  importGroups: async (groups) => {
    const safeGroups = Array.isArray(groups) ? groups : []
    set({ groups: safeGroups })
    await localforage.setItem(STORAGE_KEY, safeGroups)
  },
}))
