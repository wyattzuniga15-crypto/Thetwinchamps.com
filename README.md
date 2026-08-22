# Aria — AI Companion (interactive simulation game)

A browser game about one thing: **a fictional AI called Aria who lives, visibly and
persistently, inside a simulated apartment — and you can video-call her.**

Aria is not a real person. She's an artificial character with a virtual human body,
and she knows it. But she walks, reaches, blinks, breathes, sits, reads, tidies,
loses the remote, and answers your call from wherever her simulated life happens
to have taken her.

## Play it

It's a fully static site — no build step, no server logic.

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

or any static host (GitHub Pages works as-is).

> Best experienced in a desktop or mobile Chrome/Edge/Safari with sound on.
> Voice input uses the Web Speech API where available; there's always a text box too.

## What you can do

- **Video Call** — a FaceTime-style call into her room. She has to walk over and
  pick up her phone before the video connects. Handheld camera sway, auto-exposure,
  film grain, focus pulses. When you ask her to do something physical she props the
  phone on the nearest surface so you can watch her work, then picks it back up.
- **Message** — an iMessage-style thread. Commands sent by text really happen in
  the room; call her afterwards and the TV you asked for is on.
- **Talk naturally** — no command syntax:
  - `pick up the apple` → she finds it, walks over, reaches, grips it with her fingers
  - `put it next to the cup` → pronouns resolve from context
  - `actually, move it to the desk` → still the apple
  - `take the water out of the fridge and then sit on the couch` → multi-step plans
  - `open the drawer`, `close the curtains`, `turn the tv on`, `water the plant`,
    `throw the banana at the couch`, `clean the room`, `where are my keys?` …
- **Her life goes on without you.** While you're away (even with the tab closed)
  her time is simulated: she reads, watches TV, drinks water, tidies, moves things.
  Come back hours later and the room reflects what she did — and she'll text you
  about it.
- **She reaches out.** Random events happen in the room (a book slides off the
  shelf, her phone buzzes, the lights flicker). Sometimes she calls *you* to tell
  you about it, with a ringtone and an accept/decline screen.
- **She remembers.** Your name, things you ask her to remember, where you said you
  left your keys, past conversations, and every object's position — all persisted
  in `localStorage`. Player-chosen object placements become the new "correct" spot,
  so her tidying never undoes your arrangements.

## How it works (all client-side, ~zero dependencies)

| Module | Role |
| --- | --- |
| `js/world.js` | The room: geometry, procedural textures, day/night light through the window, working fridge/drawer/curtains/doors, TV with live channels, gravity for dropped/thrown items, save/load of every object |
| `js/character.js` | Aria's body: procedural humanoid, walk cycle, two-bone IK arms, 5-fingered hands that curl around objects, blinking, breathing, saccades, brow/jaw emotion rig, lip-sync jaw |
| `js/nav.js` | A* grid navigation with obstacle inflation and line-of-sight smoothing |
| `js/agent.js` | Her brain-body bridge: action planner/executor (go, pick, place, open, sit, pour, throw…), autonomous life scheduler, random events, offline-time simulation |
| `js/nlu.js` | Natural-language understanding: verbs, alias matching, pronoun/context tracking, multi-clause commands, spatial prepositions |
| `js/dialogue.js` | Personality + world-aware conversation. Optional: paste an Anthropic API key in Settings and open-ended chat is answered by Claude, grounded in the live room state (key stays in your browser) |
| `js/memory.js` | Long-term memory: facts, notes, event journal, conversation log |
| `js/voice.js` | Speech synthesis with lip-sync drive, speech recognition, WebAudio ringtone |
| `js/main.js` | The phone UI: home/profile, call screen and cameras, messages, incoming calls, persistence |
| `vendor/three.module.js` | Three.js r160, vendored so the game is fully self-contained |

## The fiction, stated plainly

The game never pretends Aria is a human. The interface labels her `AI · SIM`
everywhere, and if you ask her directly she'll tell you: she's a fictional AI
character inside a virtual world — one that still feels, from the inside, like a life.

---

*The `src/` directory contains an unrelated Next.js project from this repository's
base branch and is not part of the game.*
