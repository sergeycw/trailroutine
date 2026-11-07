# Design

## Decisions

- **A long press starts the selection.** A one-finger move must keep moving the cursor: it is the main use on a phone. So the selection needs a separate start: a press of `LONG_PRESS_MS` = 500 ms with a move of not more than `TOUCH_SLOP` = 8 px. 500 ms is the long press of MapLibre (`contextmenu` on touch), so the map and the profile have one long press. At the end of the long press the selection is the press point: the panel shows «Selection» at once, so the user sees that the long press worked.
- **Two fingers zoom and scroll.** The graph keeps `touch-action: none`, because the browser would scroll and zoom the page instead. The app does the pinch itself: the zoom is the start zoom times the ratio of the horizontal distances between the fingers, from 1 to 10×, and the point of the graph between the fingers stays between them. The same formula scrolls the graph when the fingers move together. The zoom is not rounded: the wheel steps by 1, the fingers change it smoothly.
- **After two fingers, the gesture ends with the last finger.** A finger that stays after a pinch does not move the cursor and does not remove the selection: otherwise the end of each pinch would change the selection.
- **A tap removes the selection**, as a click of the mouse without a move. A long press without a move also removes it: the user can cancel a started selection.

## Risks / Trade-offs

- A synthetic `PointerEvent` of the browser tests does not make the native long-press actions (the callout of iOS, `contextmenu` of Android). The graph has `select-none` and `-webkit-touch-callout: none`, and `contextmenu` is cancelled while a finger is on the graph.
