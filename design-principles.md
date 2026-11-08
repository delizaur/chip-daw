## Core principles

* OP-1 inspired aesthetic: modern and minimalist, but also colorful and a bit fun.
* Everything works locally, the user can import and export projects from/to their machine. For now, it won't have a server/cloud, but maybe in the future I will make a place to upload and share projects.
* Focused on making 8bit/16bit/chiptune/retro/videogame type music, but the sounds can be expanded over time.

## Tracks

* 8 tracks
* The user can quickly switch to a track by pressing the 1-8 keys.
* Notes are recorded as midi, not audio (for now)
* Each track as a *preset* assigned to it. Midi notes + preset = sound.
* Normally, one track = one preset, but if the user runs out of tracks, they will be allowed to change the preset assigned to a track mid-song with a construct similar to a "wall", where on the same track, presets can be different on its left and right sides.

## Presets

They are a pipeline that turn midi notes into sound. They can be opened, edited and saved. The pipeline has three stages:

* **Sequencer**: they modify the midi notes inputted by the user (example: arp). other settings like quantization can go here.
* **Synth**: What turns the notes into sound. There will be several synth engines available, configurable with parameters.
* **Effect(s)**: They modify the sound coming out of the synth. (examples: delay, reverb, bitcrush, etc). They also have configurable parameters. On preset, there can be zero, one or multiple effects. They are applied in a chain, where the output of the previous effect is used as the input of the next.
Sequencers, synths and effects are represented as "boxes", that can be freely swapped in and out between presets. The only box required is the synth, everything else is optional.
* Every synth and effect parameter can be automated.

## Layout

* Organization inspired by Ableton-Live, where everything you need is visible in a single window.
* The layout can be organized with a top bar, left sidebar, center area and right sidebar.
* #### Top bar

  * Play/pause button.
  * Record (with overdub mode).
  * Tempo value in BPM, meter and subdivision. Songs can have BPM, meter and subdivision changes. Tempo can be automated.
  * Global app volume.
  * MIDI input selector.
  * Import and export project buttons.
* #### Left sidebar

  * Has a list of all the presets.
  * They can be organized in folders.
  * They can be copied.
  * Presets can also be imported and exported.
* #### Center

  * The biggest area, shows all 8 tracks
  * Recorded snippets are shown as boxes that can be copied, pasted, deleted and dragged around.
* #### Right Sidebar

  * Shows the presets assigned to every track. Clicking on a preset allows the user to edit it (see below)
  * Every track also has a mute and solo button, and a volume control.
* #### Preset editing (bottom of the screen)

  * When editing a preset (from the left preset list or from a track), the bottom of the screen acts as the preset editing area. Like in ableton Live, the preset "boxes" are shown from left to right, with every parameter visible and editable.
  * Sequencers, synths and effects can be added or replaced from a list.
  * Modifying a parameter while recording automates it.

