# Third-party notices

Lefi Crop itself is MIT-licensed (see `LICENSE`). The components below are not part of that licence and keep
their own terms.

The desktop admin and the mobile app bundle the fonts and libraries listed below. Components
the project plans to use, and the terms that must be respected:

| Component | Use | Terms (verify before release) |
|---|---|---|
| HumanoidAppLab/GDG-Hackathon (MH3 Genesis starter) | Robot simulation | Code: MIT, © 2026 Humanoid Application Lab, DataRealm Inc. and Mirsee Robotics Inc. Fetched into a git-ignored `vendor/` folder, not committed. |
| `MH3.usd` (inside the starter) | Robot model | © 2026 Mirsee Robotics Inc. — permission limited to submissions to the GDG Windsor *Build with AI* hackathon. **Not MIT. No commercial use assumed.** |
| Genesis World | Physics/rendering (via starter) | See its repository license. |
| Ollama | Local inference runtime | See its repository license. |
| Google Gemma 4 | Local language model | Gemma terms of use — to be reviewed for the exact model downloaded. |
| Outfit, Manrope, JetBrains Mono (via `@fontsource/*`) | Desktop admin typography, bundled locally | SIL Open Font License 1.1 |
| Material Symbols Rounded (via `material-symbols`) | Desktop admin icons, bundled locally | Apache License 2.0 |
| Tauri 2, React, TanStack, Zustand, Vite, reqwest, keyring and other JS/Rust dependencies | Desktop admin | Listed in `pnpm-lock.yaml` / `apps/desktop/src-tauri/Cargo.lock`; MIT / Apache-2.0 family — full audit before release |
| Outfit, Manrope, JetBrains Mono fonts | Mobile app typography (bundled in `apps/lefi-mobile/assets/fonts/`) | SIL Open Font License 1.1 — licence texts committed next to the fonts. |
| Material Symbols (via `material_symbols_icons`) | Mobile app icons (bundled font) | Font: Apache 2.0 (Google); package: see its pub.dev licence. |
| Flutter, Riverpod, go_router and other Dart packages | Mobile app | BSD-3 / MIT style licences — full list in `apps/lefi-mobile/pubspec.lock`; shown in-app via Flutter's licence registry when an About screen is added. |
| FastAPI, Pydantic, SQLAlchemy, Alembic, uvicorn, aiomqtt and other Python packages | Lefi Brain and simulators | MIT / BSD / Apache-2.0 family — full list in `services/brain/uv.lock` and `simulators/*/uv.lock` |
