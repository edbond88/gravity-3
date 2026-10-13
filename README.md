# The three-body problem

An interactive simulation of three stars pulling on each other with gravity — and of how quickly that turns into chaos.

**▶ Live demo: [edbond88.github.io/gravity-3](https://edbond88.github.io/gravity-3/)**

[![Three stars tracing chaotic orbits](screenshot.webp)](https://edbond88.github.io/gravity-3/)

## Features

- **Real physics** — Newtonian gravity in AU, years and solar masses, integrated with velocity Verlet and an adaptive time step that shrinks during close encounters.
- **Adjustable masses** — set each star's mass from 0.2 to 5 M☉, or shuffle them.
- **Known solutions** — besides random chaotic starts, pick a famous configuration:
  - classical: Lagrange's equilateral triangle and Euler's collinear solution;
  - periodic orbits: the figure-eight (Moore, Chenciner & Montgomery) and the butterfly, moth, goggles, dragonfly and yin-yang orbits (Šuvakov & Dmitrašinović, 2013);
  - a stable hierarchical triple: a tight binary with a distant third star.

  Most of them are unstable, so they hold their shape for a few periods and then fall apart into chaos.
- **Drag stars** — pause, move any star somewhere else, and play; the centre of mass is recomputed.
- **Sound** — close encounters thump, panned to where they happen.
- **Auto-restart** — when a star escapes, a new system starts.

## Controls

| Key | Action |
|---|---|
| Space | Pause / play |
| R | Restart |
| N | Shuffle masses |
| M | Sound on / off |
| + / − | Faster / slower time |
| 1 … 9, 0 | Choose a starting configuration |

## Running locally

No build step — it's plain HTML, CSS and JavaScript. Serve the folder with any static server:

```bash
python3 -m http.server 8173
```

Then open <http://localhost:8173>.
