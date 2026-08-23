import { useMemo, useState } from 'react'
import { ArrowLeftRight, Plus, RotateCcw, ShieldAlert, Trash2 } from 'lucide-react'
import { useAccountStore } from '@/store/accountStore'
import { ManualFailoverGroup, useManualFailoverStore } from '@/store/manualFailoverStore'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'

type Draft = {
  id?: string
  name: string
  tag: string
  accountIds: string[]
  primaryUrl: string
  backupUrl: string
}

const emptyDraft: Draft = { name: '', tag: '', accountIds: [], primaryUrl: '', backupUrl: '' }

export function ManualFailoverPage() {
  const accounts = useAccountStore(state => state.accounts)
  const swapAddonEnabledState = useAccountStore(state => state.swapAddonEnabledState)
  const { groups, saveGroup, removeGroup, setMode } = useManualFailoverStore()
  const { toast } = useToast()
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [runningId, setRunningId] = useState<string | null>(null)

  const availableAddons = useMemo(() => {
    const selected = accounts.filter(account => draft.accountIds.includes(account.id))
    const source = selected.length ? selected : accounts
    const urls = new Map<string, string>()
    source.flatMap(account => account.addons).forEach(addon => {
      if (!urls.has(addon.transportUrl)) urls.set(addon.transportUrl, addon.metadata?.customName || addon.manifest.name)
    })
    return [...urls.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [accounts, draft.accountIds])

  const openEditor = (group?: ManualFailoverGroup) => {
    setDraft(group ? {
      id: group.id,
      name: group.name,
      tag: group.tag,
      accountIds: group.accountIds,
      primaryUrl: group.primaryUrl,
      backupUrl: group.backupUrl,
    } : emptyDraft)
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!draft.name.trim() || !draft.tag.trim() || !draft.accountIds.length || !draft.primaryUrl || !draft.backupUrl) return
    if (draft.primaryUrl === draft.backupUrl) {
      toast({ title: 'Choose two different addons', variant: 'destructive' })
      return
    }
    await saveGroup({ ...draft, name: draft.name.trim(), tag: draft.tag.trim() })
    setDialogOpen(false)
    toast({ title: draft.id ? 'Failover group updated' : 'Failover group created' })
  }

  const runSwap = async (group: ManualFailoverGroup, target: 'primary' | 'backup') => {
    if (runningId) return
    setRunningId(group.id)
    const disableUrl = target === 'backup' ? group.primaryUrl : group.backupUrl
    const enableUrl = target === 'backup' ? group.backupUrl : group.primaryUrl
    const results = await Promise.allSettled(
      group.accountIds.map(accountId => swapAddonEnabledState(accountId, disableUrl, enableUrl))
    )
    const succeeded = results.filter(result => result.status === 'fulfilled').length
    const failed = results.length - succeeded
    if (succeeded > 0) await setMode(group.id, target)
    setRunningId(null)
    toast({
      title: target === 'backup' ? 'Manual failover complete' : 'Failback complete',
      description: `${succeeded} account${succeeded === 1 ? '' : 's'} updated${failed ? `; ${failed} failed` : ''}.`,
      variant: failed ? 'destructive' : 'default',
    })
  }

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2"><ArrowLeftRight className="text-primary" /> Manual Failover</h2>
          <p className="text-sm text-muted-foreground mt-1">Switch a tagged group of accounts between primary and backup addons in one action.</p>
        </div>
        <Button onClick={() => openEditor()}><Plus /> New Group</Button>
      </div>

      {groups.length === 0 ? (
        <Card><CardContent className="py-14 text-center text-muted-foreground">Create a group to configure your first one-tap Debrid failover.</CardContent></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {groups.map(group => {
            const members = accounts.filter(account => group.accountIds.includes(account.id))
            const primaryName = members.flatMap(a => a.addons).find(a => a.transportUrl === group.primaryUrl)?.manifest.name || 'Primary addon'
            const backupName = members.flatMap(a => a.addons).find(a => a.transportUrl === group.backupUrl)?.manifest.name || 'Backup addon'
            const isRunning = runningId === group.id
            return (
              <Card key={group.id} className={group.activeMode === 'backup' ? 'border-amber-500/40' : ''}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div><CardTitle>{group.name}</CardTitle><span className="inline-flex mt-2 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-xs font-semibold">#{group.tag}</span></div>
                    <span className={`text-xs font-bold rounded-full px-2 py-1 ${group.activeMode === 'primary' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'}`}>{group.activeMode === 'primary' ? 'PRIMARY ACTIVE' : 'BACKUP ACTIVE'}</span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="text-sm space-y-1"><p><b>{primaryName}</b> → {backupName}</p><p className="text-muted-foreground">{members.map(a => a.name).join(', ') || 'No matching accounts'} · {members.length} account{members.length === 1 ? '' : 's'}</p></div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant={group.activeMode === 'backup' ? 'default' : 'destructive'} disabled={isRunning || group.activeMode === 'backup'} onClick={() => runSwap(group, 'backup')}><ShieldAlert /> Fail Over</Button>
                    <Button variant="outline" disabled={isRunning || group.activeMode === 'primary'} onClick={() => runSwap(group, 'primary')}><RotateCcw /> Fail Back</Button>
                  </div>
                  <div className="flex justify-end gap-2 border-t pt-3"><Button variant="ghost" size="sm" onClick={() => openEditor(group)}>Edit</Button><Button variant="ghost" size="sm" className="text-destructive" onClick={() => removeGroup(group.id)}><Trash2 /> Delete</Button></div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{draft.id ? 'Edit' : 'Create'} Manual Failover Group</DialogTitle></DialogHeader>
          <div className="space-y-5">
            <div className="grid sm:grid-cols-2 gap-4"><div className="space-y-2"><Label>Group name</Label><Input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Family accounts" /></div><div className="space-y-2"><Label>Account tag</Label><Input value={draft.tag} onChange={e => setDraft({ ...draft, tag: e.target.value.replace(/^#/, '') })} placeholder="family" /></div></div>
            <div className="space-y-2"><Label>Accounts</Label><div className="grid sm:grid-cols-2 gap-2 rounded-lg border p-3">{accounts.map(account => <label key={account.id} className="flex items-center gap-2 p-2 rounded hover:bg-muted cursor-pointer"><Checkbox checked={draft.accountIds.includes(account.id)} onCheckedChange={checked => setDraft({ ...draft, accountIds: checked ? [...draft.accountIds, account.id] : draft.accountIds.filter(id => id !== account.id) })} /><span className="text-sm">{account.name}</span></label>)}</div></div>
            <div className="space-y-2"><Label>Primary addon</Label><Select value={draft.primaryUrl} onValueChange={primaryUrl => setDraft({ ...draft, primaryUrl })}><SelectTrigger><SelectValue placeholder="Select primary addon" /></SelectTrigger><SelectContent>{availableAddons.map(([url, name]) => <SelectItem key={url} value={url}>{name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Backup addon</Label><Select value={draft.backupUrl} onValueChange={backupUrl => setDraft({ ...draft, backupUrl })}><SelectTrigger><SelectValue placeholder="Select backup addon" /></SelectTrigger><SelectContent>{availableAddons.map(([url, name]) => <SelectItem key={url} value={url}>{name}</SelectItem>)}</SelectContent></Select></div>
            <p className="text-xs text-muted-foreground">Both addons must already be installed on every selected account. The operation updates each account with one Stremio collection write. Any Autopilot rule containing either addon is paused so it cannot immediately undo your manual choice.</p>
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button><Button onClick={handleSave} disabled={!draft.name || !draft.tag || !draft.accountIds.length || !draft.primaryUrl || !draft.backupUrl}>Save Group</Button></div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
