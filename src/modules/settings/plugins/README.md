# Settings · Extensions / Modules

Functional split of the Extensions settings tab.

```
plugins/
  PluginManager.tsx        # tabs: Installed / Plugin Store
  InstalledModuleCard.tsx  # rounded module card
  PluginAssetImage.tsx     # shared icon renderer
  helpers.ts               # small shared helpers
```

## Installed UX

- Modules render as **list rows** (`InstalledModuleCard`).
- **Click a card** → floating `Dialog` (shadowed popover surface) with full module config:
  enable toggle, commands, shortcuts, aliases/tags, preferences, uninstall.
- Marketplace catalog is fetched in the background (`src/plugin/marketplaceCatalog.ts`).
  Compatible updates appear as an accent chip plus a compact Update action on the row
  and in the config dialog. Further Update clicks enqueue and run one at a time.
  Rescan also refreshes the catalog.
- Import archive + marketplace Plugin Store remain on the page.

Parent entry: `../PluginManager.tsx` re-exports this package.
