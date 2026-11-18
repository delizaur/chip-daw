# Keyboard shortcuts

"Ctrl" means Cmd on a Mac. Shortcuts are ignored while you're typing in a text field or a dropdown has focus.

## Two keyboard modes

The computer keyboard either **plays notes** (the keyboard piano, on by default) or works as **letter shortcuts**. The key left of 1 switches between the two: ` on US keyboards, º on Spanish ones, ^ on German ones.

Most shortcuts work in both modes. The letter shortcuts below only work with the keyboard piano off, because those letters play notes otherwise.

## Transport and project

| Key | Action |
|---|---|
| Space | Play / pause |
| Home | Move the playhead to the start |
| Escape | Stop all sounding notes and clear the selection (while browsing the library: stop browsing) |
| Ctrl+Z | Undo. Undoing a recording also puts the playhead back where the recording started |
| Ctrl+Shift+Z or Ctrl+Y | Redo |
| Ctrl+S | Export the project (`.chip`) |
| Ctrl+O | Import a project |
| 1–9 | Select track 1–9 |

## Editing

These act on **notes** if you clicked the piano roll last, and on **clips** otherwise.

| Key | Action |
|---|---|
| Delete or Backspace | Delete the selection |
| Ctrl+A | Select all |
| Ctrl+C | Copy |
| Ctrl+V | Paste (clips go to the playhead on the selected track) |
| Ctrl+D | Duplicate |
| Ctrl+I | Insert bars: the bars selected on the ruler (Shift-drag it), or the bar at the playhead |
| Ctrl+Delete or Ctrl+Backspace | Delete bars (same rule) |

## Arrow keys

The arrow keys work whether the keyboard piano is on or off.

| Key | In the piano roll, with notes selected | Otherwise |
|---|---|---|
| ← / → | Move the notes one grid step | Move the playhead one bar back / forward and select the clip under it on the current track |
| ↑ / ↓ | Transpose the notes a semitone | Select the track above / below (empty ones too) and the clip under the playhead on it |
| Shift+↑ / Shift+↓ | Transpose the notes an octave | — |

If the playhead is partway through a bar, ← goes to the start of that bar first. When there's no clip under the playhead, the clip selection is cleared.

## Letter shortcuts (keyboard piano off)

| Key | Action |
|---|---|
| R | Record arm on / off |
| O | Overdub on / off |
| C | Metronome (click) on / off |
| L | Loop on / off |
| M | Mute: on release, mutes / unmutes the current track. **Hold M and press a number** to mute / unmute that track instead (you can press several). |
| S | Solo: works the same way as M |
| A / D | Move the playhead to the previous / next clip edge on the current track, selecting that clip |
| Enter | Open the selected clip in the piano roll (if a button has focus, Enter presses that button instead) |
| K | Open / close the **Keyboard** tab (closing goes back to the tab you were on) |
| U | Clip preset: **Make unique** |
| P | Clip preset: **Use track preset** |
| T | Clip preset: **Load to track** |

## Browsing the preset library

**I** (for "instrument") starts and stops browsing the library from the keyboard. It works with the keyboard piano on or off. While browsing, the library panel has an orange frame, and the keyboard piano is paused.

| Key | Action |
|---|---|
| ↑ / ↓ or W / S | Select the previous / next row (a folder, or a preset in an open folder) |
| ← / → or A / D | Skip to the previous / next folder (from a preset, ← goes to its own folder first) |
| Enter | On a folder: open / close it. On a preset: load it onto the current track (undoable) |
| I or Escape | Stop browsing |

## Keyboard piano (when on)

| Key | Action |
|---|---|
| A W S E D F T G Y H U J K O L P ; | Play notes from C4 up to E5. The middle letter row is the white keys and the row above it is the black keys |
| Z / X | Octave down / up |
| C / V | Velocity down / up |

## Keyboard tab

The **Keyboard** tab (K) shows a full piano:

- the computer keys that play each note, with the octave and velocity (− / + buttons, or Z / X and C / V);
- click a key to play it, or drag across the keys to slide between notes;
- notes played live (mouse, computer keyboard or MIDI) light up in the track's color, and notes that recorded clips are playing light up dimmer in each track's color;
- **Names** shows every note name, and **Scale** highlights a scale (choose the root and the scale: major, minor, harmonic / melodic minor, lydian, mixolydian, dorian, phrygian, locrian).

## Focused controls

These apply to whichever control has keyboard focus (click it or Tab to it).

| Control | Keys |
|---|---|
| Knobs and sliders | ↑ / → and ↓ / ← nudge the value: 1% per press, 0.1% with Shift, or one step on stepped knobs. Page Up / Page Down: ±10%. Home / End: minimum / maximum |
| Selectors (wave type and similar) | Arrow keys move between the options |
| Bottom panel resize handle | ↑ / ↓ make the panel taller / shorter (16 px, or 64 px with Shift). Home resets it to the minimum height |
| Tempo field | Enter applies the value, Escape cancels |
| Renaming a library preset or folder | Enter applies the name, Escape cancels |
| Preset name | Enter confirms |

## Mouse, for reference

| Where | Gesture |
|---|---|
| Arrangement | Mouse wheel scrolls sideways (use the scrollbar on the right to scroll the tracks). Ctrl+wheel zooms. Drag with the middle button (wheel click) to scroll sideways |
| Empty lane space | Click: select the track, deselect clips and (when stopped) move the playhead there. Drag: select the clips in a rectangle (Shift adds to the selection). Double-click: create a one-bar clip |
| Clip | Click to select it (Shift adds / removes). Drag to move it (also to other tracks). Drag an edge to resize it. Double-click to open it in the piano roll. Alt while dragging turns snapping off |
| Track name (left of the lanes) | Click to select the track and deselect clips |
| Ruler | Click or drag to move the playhead. Shift-drag to select whole bars. With the loop on, drag its start / end markers |
| Tempo lane | Click to add a tempo change. Drag a point to move it. Shift-click a point to make it ramp to the next one (or jump again). Double-click a point to delete it. Double-click the time-signature strip to change a bar's time signature |
| Preset editor | Mouse wheel scrolls it sideways |
| Library | Click to select. Double-click a preset to load it onto the current track. Double-click a folder to open / close it |
