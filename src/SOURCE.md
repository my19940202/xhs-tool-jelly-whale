# Blue Whale Jelly source and adaptation

Reference: https://claude.ai/artifact/CGa66nQyfdNP5mNYVySRii

The publicly served artifact's readable inline JavaScript was inspected on
2026-11-10, at the user's request to reproduce its whale appearance and interaction.
The geometry, physics, shaders and renderer modules are adapted from that source;
this note records provenance, and does not assert an upstream license.

The original modules use Three.js 0.170.0. This experience uses the pinned
`three-whale` npm alias so other experiences retain their existing Three.js version.
No Claude frame runtime, remote artifact embedding, tracking or login code is used.

The application integration is local: container-relative framing, controls,
lifecycle handling, resource cleanup and diagnostics. Gulp inflation, krill paths,
spout particles and night-mode interactions are excluded. Shader uniform slots for
unused lighting/material branches remain to preserve the original render pipeline;
night and glow inputs are always zero. The throat's static clear material and inner
baleen remain part of the specimen's appearance.

## Validation

`pnpm typecheck`, `pnpm test`, `pnpm build`.
Browser review: compare the initial Ocean specimen and released deformations against
the reference, then exercise colours, firmness/damping, grab/twist/release, reset,
pause, resize and navigation. Runtime diagnostics report measured FPS, step cost,
substeps, volume ratio and strain; they are instance-local, not a window global.
