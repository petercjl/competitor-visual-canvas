# Competitor visual canvas

Application package for collecting Taobao/Tmall visual references into SealSeek Infinite Canvas. The application owns the collection workflow and layout. `@petercjl/tbcli` owns product collection; `@petercjl/sealseek-media-cli` owns service authentication and generic canvas operations.

Requires Node.js 22+, `tbcli item media`, and SealSeek `canvas batch` (including text-batch) / `media inspect` capabilities. Service credentials stay with the dependency packages. The public npm package supports Codex, SealSeek and WorkBuddy adapters. macOS Codex business runs are verified; other host runtime evidence is separate from portable package tests.

```sh
competitor-visual-canvas doctor --json
competitor-visual-canvas collect --input PRODUCT_ID --input OTHER_PRODUCT_ID --run NEW_DIR --json
competitor-visual-canvas plan --run NEW_DIR --json
competitor-visual-canvas canvas --run NEW_DIR --json
competitor-visual-canvas canvas --run NEW_DIR --submit --json
```

Bare IDs default to Taobao. Each product has four Frames named after its shop. Main images and videos run horizontally; detail images run vertically with zero inter-image gap; SKU images form rows of five. Regions run left to right: main images, main videos, SKU, detail images. Between products, main-image/video/SKU Frames run vertically and detail Frames run horizontally. Each region has a text heading. Fixed column origins preserve existing positions during append. Empty video lists retain an empty Frame and explicit coverage evidence.

The private run directory holds raw collection results, `assets.manifest.json`, `layout.plan.json`, `canvas.batch.json`, `canvas.state.json` and `collection-report.json`. Existing outputs are preserved. Replay reuses the recorded canvas and stable IDs. Unknown creation outcomes require checking existing canvases and explicit recovery; no automatic duplicate creation.

Use `skill source/status/install/update --agent codex|sealseek --json` for the canonical bundled Skill and managed links. Unmanaged targets are preserved. Windows adapters remain unresolved. Source installs do not self-update. After future publication the explicit update path is `npm install -g @petercjl/competitor-visual-canvas@latest`, followed by `competitor-visual-canvas skill update --agent AGENT --json`; linked Skills follow the owning package. The host suite may manage that lifecycle after separate registration.

Dependency entry points can be configured outside the package with `configure --tool tbcli|sealseek-media --entry ABSOLUTE_CLI_PATH --submit --json`. Inspect them with `doctor`, and delegate via `tool run TOOL ARGS...`; source discovery and execution use the same selected entry. No credentials are stored by the application.


Append products using the newest completed run:

```sh
competitor-visual-canvas append --base-run BASE_DIR --run NEW_DIR --input NEW_PRODUCT_ID --json
competitor-visual-canvas canvas --run NEW_DIR --json
competitor-visual-canvas canvas --run NEW_DIR --submit --json
```

The new run records cumulative assets and uses the same canvas. Duplicate IDs are skipped. Old elements retain their positions; a stale base, manual changes or excessive column width stops before saving. Main-image/video/SKU columns reserve at least 2400/1600/1840 canvas units initially. Legacy vertical-region canvases require an explicitly requested `reflow --run DIR --submit`; normal append does not move existing elements.

Find an existing application canvas by its exact name and append without a previous local run:

```sh
competitor-visual-canvas find --title "My canvas" --json
competitor-visual-canvas append --title "My canvas" --run NEW_DIR --input NEW_PRODUCT_ID --json
competitor-visual-canvas canvas --run NEW_DIR --json
competitor-visual-canvas canvas --run NEW_DIR --submit --json
```

Name lookup scans all result pages and matches the full title. Multiple matches return `AMBIGUOUS_CANVAS` with candidates; select with `append --canvas ID`. A missing name returns `CANVAS_NOT_FOUND`. Lookup never creates a canvas. ID and title may be combined to verify the chosen name; `--base-run` is an alternative selector.

Cloud recovery restores this application's four-region layout, product IDs and existing links from element source metadata, including empty Frames. Old coordinates stay intact and submission rechecks the saved snapshot. Incomplete or unrelated canvases return `CANVAS_STATE_UNSUPPORTED`. Recovery snapshots live in private application state, outside npm. Original product titles, SKU attributes and collection evidence unavailable in cloud metadata are marked unavailable; a completed local base run retains that richer evidence. The application controls these rules; the media CLI continues to provide generic canvas listing, reading and writing.

Agent prompt: “用竞品视觉素材画板工具，找到画板‘我的竞品素材’，追加商品 ID：123456789012。”

## Installation and updates

Install `@petercjl/competitor-visual-canvas` globally, then use `competitor-visual-canvas skill install --agent codex|sealseek|workbuddy --json` for the current Agent. Its npm dependencies provide compatible tbcli and sealseek-media CLIs; service authorization remains separate. SealSeek resolves the active default workspace or a configured SEALSEEK_SKILLS_DIR; ambiguous roots require an explicit --path.

Global installations check stable latest on business invocation once per day, download/install a newer version, refresh already managed Skills with backups and run the original command once. Local edits stop automatic synchronization. Offline checks keep the current version; interrupted updates retain package backups in private state. `update auto status|on|off` controls the policy, and `update install --yes` forces a check. Suite-local installations stay managed by taobao-ai-ops; Git development stays Git-owned. Custom Skill paths need explicit skill synchronization.

Application run directories and credential profiles stay outside npm. Continue a canvas from its newest completed run; backup and unknown-write recovery use that existing canvas rather than creating another.
