# Preset assets — read-only, plugin-shipped Asset Store column

Drop image files (`.png` / `.jpg` / `.jpeg` / `.webp` / `.gif`) into this
directory. They are surfaced read-only in the Asset Store's left rail under the
virtual folder `presets`, served straight from here, and cannot be deleted or
renamed in the UI. They are NOT written into the per-project generated-asset
index. See `backend/src/assets/presetAssets.ts`.
