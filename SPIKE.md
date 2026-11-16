# Desktop-layer spike (Task 1)

Run in an isolated headless GNOME Shell 50.1 with Desktop Icons (DING) enabled,
using synthetic pointer and keyboard input (`tests/shell/run.sh spike`).

| Strategy | Visible on wallpaper | Click reaches card | Typing reaches entry |
|---|---|---|---|
| A: background group | yes | **no** – DING's window took the click; typing opened DING's "Find files" box | **no** |
| B: window group, directly above the desktop-type window | yes | **yes** | **yes** (`abc` typed, key focus on the entry) |

**Chosen: B.** `lib/layer.js` keeps the layer just above DING's window and
below every normal window. Mutter re-sorts the window group, and DING's
window appears after the extension starts, so the position is re-applied on
`restacked`, on window `map`, on `child-added`, and once more on idle.

Notes:
- DING patches `global.get_window_actors()` to hide its window; walk
  `global.window_group.get_children()` instead and detect it by window type
  `DESKTOP`, `meta_window.customJS_ding`, or a title starting with `@!`.
- The layer is not a window, so it cannot appear in Alt-Tab.
- GNOME starts in the overview; the layer (like all windows) is not drawn there.
