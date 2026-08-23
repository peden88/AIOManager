import { useState } from 'react'
import { ArrowLeftRight, Loader2, RotateCcw, Settings2, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useManualFailoverStore } from '@/store/manualFailoverStore'
import { useToast } from '@/hooks/use-toast'

type HomeButtonSlot = 1 | 2

const UNASSIGNED = '__unassigned__'

export function ManualFailoverQuickActions() {
  const { groups, runGroup, assignHomeButton } = useManualFailoverStore()
  const { toast } = useToast()
  const [runningSlot, setRunningSlot] = useState<HomeButtonSlot | null>(null)
  const [configuringSlot, setConfiguringSlot] = useState<HomeButtonSlot | null>(null)
  const [selectedGroupId, setSelectedGroupId] = useState(UNASSIGNED)

  const openConfiguration = (slot: HomeButtonSlot) => {
    const assignedGroup = groups.find(group => group.homeButtonSlot === slot)
    setSelectedGroupId(assignedGroup?.id || UNASSIGNED)
    setConfiguringSlot(slot)
  }

  const saveConfiguration = async () => {
    if (!configuringSlot) return
    try {
      await assignHomeButton(configuringSlot, selectedGroupId === UNASSIGNED ? null : selectedGroupId)
      toast({ title: `Quick action ${configuringSlot} updated` })
      setConfiguringSlot(null)
    } catch (error) {
      toast({
        title: 'Could not save quick action',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    }
  }

  const runQuickAction = async (slot: HomeButtonSlot) => {
    const group = groups.find(item => item.homeButtonSlot === slot)
    if (!group || runningSlot) return

    const target = group.activeMode === 'primary' ? 'backup' : 'primary'
    setRunningSlot(slot)
    try {
      const { succeeded, failed } = await runGroup(group.id, target)
      toast({
        title: target === 'backup' ? `${group.name} failed over` : `${group.name} restored`,
        description: `${succeeded} account${succeeded === 1 ? '' : 's'} updated${failed ? `; ${failed} failed` : ''}.`,
        variant: failed ? 'destructive' : 'default',
      })
    } catch (error) {
      toast({
        title: 'Quick failover failed',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setRunningSlot(null)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <ArrowLeftRight className="h-5 w-5 text-primary" />
        <div>
          <h2 className="text-lg font-bold leading-tight">Quick Failover</h2>
          <p className="text-xs text-muted-foreground">One-tap controls for your assigned failover groups.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {([1, 2] as HomeButtonSlot[]).map(slot => {
          const group = groups.find(item => item.homeButtonSlot === slot)
          const isRunning = runningSlot === slot
          const willFailOver = group?.activeMode === 'primary'

          return (
            <Card key={slot} className={group?.activeMode === 'backup' ? 'border-amber-500/50' : 'border-primary/30'}>
              <CardContent className="relative p-3">
                <Button
                  type="button"
                  variant={group && willFailOver ? 'destructive' : 'default'}
                  disabled={runningSlot !== null}
                  onClick={() => group ? runQuickAction(slot) : openConfiguration(slot)}
                  className={`h-28 w-full flex-col gap-1.5 pr-12 text-white shadow-md ${
                    group && !willFailOver ? 'bg-emerald-600 hover:bg-emerald-700' : ''
                  } ${!group ? 'bg-muted text-muted-foreground hover:bg-muted/80' : ''}`}
                >
                  {isRunning ? (
                    <Loader2 className="h-7 w-7 animate-spin" />
                  ) : group && willFailOver ? (
                    <ShieldAlert className="h-7 w-7" />
                  ) : group ? (
                    <RotateCcw className="h-7 w-7" />
                  ) : (
                    <Settings2 className="h-7 w-7" />
                  )}
                  <span className="text-lg font-extrabold">
                    {isRunning ? 'UPDATING…' : group ? (willFailOver ? 'FAIL OVER' : 'FAIL BACK') : `CONFIGURE BUTTON ${slot}`}
                  </span>
                  {group && <span className="max-w-full truncate text-xs font-medium opacity-90">{group.name} · {group.accountIds.length} account{group.accountIds.length === 1 ? '' : 's'}</span>}
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Configure quick failover button ${slot}`}
                  title={`Configure button ${slot}`}
                  className="absolute right-4 top-4 bg-black/20 text-white hover:bg-black/35 hover:text-white"
                  onClick={() => openConfiguration(slot)}
                  disabled={runningSlot !== null}
                >
                  <Settings2 className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Dialog open={configuringSlot !== null} onOpenChange={open => { if (!open) setConfiguringSlot(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Configure Quick Button {configuringSlot}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div className="space-y-2">
              <Label>Failover group</Label>
              <Select value={selectedGroupId} onValueChange={setSelectedGroupId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Not configured</SelectItem>
                  {groups.map(group => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.name}{group.homeButtonSlot ? ` · currently button ${group.homeButtonSlot}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              The button will fail this group over while Primary is active, then change to Fail Back while Backup is active.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfiguringSlot(null)}>Cancel</Button>
              <Button onClick={saveConfiguration}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
