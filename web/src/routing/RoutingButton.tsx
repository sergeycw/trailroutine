import { ChevronDownIcon, RouteIcon } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/state/context';
import { ACTIVITIES, getActivity } from './brouter';
import { useRouteEditing } from './editing-context';
import { tracksRouting } from './line';
import { HIKING_PROFILE, SAC_LEVELS } from './options';
import { RouteThread } from './RouteThread';
import { routerDownHint, routerDownStatus } from './router';

// The routing button and menu in the track list row, after «New track», as in the old client (spec routing,
// «Меню активностей»): active when an activity is selected, red when the router is unreachable, with a wait thread
// while the engine loads (spec routing, «Движок загружается на кнопке прокладки») and while a leg waits for a response
// (spec route-editing, «Ожидание прокладки в верхней строке»): both mean «routing is not ready yet», one sign (design
// route-thread-loader). Opening the menu checks again that the router is alive.

const OFF = 'off';

// labeled: with the activity name (the editor in the top row, mock-up 4a): «Hiking ▾»; below 640 px it is only an icon,
// and the activity is in title: the row gives the space to the track name (design editor-name-share)
export function RoutingButton({ labeled = false }: { labeled?: boolean }) {
    const editing = useRouteEditing();
    const activityId = useAppStore((state) => state.routingActivity);
    const hiking = useAppStore((state) => state.hikingOptions);
    const reachable = useAppStore((state) => state.routerReachable);
    const engineStatus = useSyncExternalStore(editing.subscribeEngine, editing.engineStatus);
    // the wait belongs to the leg, not to the activity: a request sent before the choice of Off still runs
    const routing = useAppStore((state) => tracksRouting(state.tracks));
    const activity = getActivity(activityId);
    const loading = activity !== null && engineStatus === 'loading';
    // an engine that failed during the warm-up is also «router unreachable», without a wait for the first route
    const down = activity !== null && (!reachable || engineStatus === 'failed');

    let title = 'Routing is off: lines are straight';
    if (activity && down) {
        title = `Routing: ${activity.title}. ${routerDownStatus(editing.engine)}`;
    } else if (loading) {
        title = `Routing: ${activity.title}. BRouter engine is loading`;
    } else if (activity) {
        title = `Routing: ${activity.title}`;
    }
    // engine unavailability and engine loading come first: while the engine loads, the request waits in its queue
    // (design editor-routing-indicator)
    if (routing && !down && !loading) {
        // Off with a live request: a leg sent before the choice of Off still gets routed
        title = activity ? `${title}. Calculating route` : 'Routing is off. Calculating route';
    }

    let tone = '';
    if (down) {
        tone = 'text-destructive hover:text-destructive';
    } else if (activity) {
        tone = 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary';
    }

    return (
        <DropdownMenu
            onOpenChange={(open) => {
                if (open) {
                    editing.checkRouter();
                }
            }}
        >
            <DropdownMenuTrigger
                render={
                    <Button
                        variant="ghost"
                        size={labeled ? 'sm' : 'icon-sm'}
                        aria-label={title}
                        title={title}
                        className={cn(tone, labeled && 'max-sm:size-7 max-sm:px-0')}
                        data-state={down ? 'down' : loading ? 'loading' : activity ? 'on' : 'off'}
                        aria-busy={routing || undefined}
                    />
                }
            >
                {loading || routing ? <RouteThread variant="icon" /> : <RouteIcon />}
                {labeled && (
                    <>
                        <span className="hidden max-w-24 truncate sm:inline">{activity?.title ?? 'Off'}</span>
                        <ChevronDownIcon className="hidden opacity-60 sm:block" />
                    </>
                )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-auto">
                <DropdownMenuGroup>
                    <DropdownMenuLabel>Routing</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                        value={activity?.id ?? OFF}
                        onValueChange={(value) => editing.setActivity(value === OFF ? null : String(value))}
                    >
                        <DropdownMenuRadioItem value={OFF} closeOnClick>
                            Off: straight lines
                        </DropdownMenuRadioItem>
                        {ACTIVITIES.map((item) => (
                            <DropdownMenuRadioItem key={item.id} value={item.id} closeOnClick>
                                {item.title}
                            </DropdownMenuRadioItem>
                        ))}
                    </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
                {/* options of a hiking activity: they apply to the legs routed next (spec routing, «Hiking options») */}
                {activity?.profile === HIKING_PROFILE && (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                            <DropdownMenuLabel>Hiking</DropdownMenuLabel>
                            <DropdownMenuSub>
                                <DropdownMenuSubTrigger>Max difficulty: T{hiking.sacLimit}</DropdownMenuSubTrigger>
                                <DropdownMenuSubContent className="w-auto">
                                    <DropdownMenuRadioGroup
                                        value={hiking.sacLimit}
                                        onValueChange={(value) =>
                                            editing.setHikingOptions({ ...hiking, sacLimit: Number(value) })
                                        }
                                    >
                                        {SAC_LEVELS.map((level) => (
                                            <DropdownMenuRadioItem key={level.value} value={level.value} closeOnClick>
                                                {level.title}
                                            </DropdownMenuRadioItem>
                                        ))}
                                    </DropdownMenuRadioGroup>
                                </DropdownMenuSubContent>
                            </DropdownMenuSub>
                            <DropdownMenuCheckboxItem
                                checked={hiking.avoidClimbs}
                                onCheckedChange={(checked) =>
                                    editing.setHikingOptions({ ...hiking, avoidClimbs: checked === true })
                                }
                            >
                                Avoid climbs
                            </DropdownMenuCheckboxItem>
                            <DropdownMenuCheckboxItem
                                checked={hiking.allowSteps}
                                onCheckedChange={(checked) =>
                                    editing.setHikingOptions({ ...hiking, allowSteps: checked === true })
                                }
                            >
                                Allow steps
                            </DropdownMenuCheckboxItem>
                        </DropdownMenuGroup>
                    </>
                )}
                {/* Undo and Redo hotkeys: in the button titles, not in the menu (design editor-row-cleanup) */}
                {down && (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem disabled className="text-destructive">
                            {routerDownHint(editing.engine)}
                        </DropdownMenuItem>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
