# Settings · Extensions / Modules

Functional split of the Extensions settings tab.

```
plugins/
  PluginManager.tsx        # tabs: Installed / Browse
  InstalledModuleCard.tsx  # rounded module card
  PluginAssetImage.tsx     # shared icon renderer
  helpers.ts               # small shared helpers
```

## Installed UX

- Modules render as **rounded rectangular cards** in a responsive grid.
- **Click a card** → floating `Dialog` (shadowed popover surface) with full module config:
  enable toggle, commands, shortcuts, aliases/tags, preferences, uninstall.
- Import archive + marketplace Browse remain on the page.

Parent entry: `../PluginManager.tsx` re-exports this package.
