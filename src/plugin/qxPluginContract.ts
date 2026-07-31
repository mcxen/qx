/**
 * Inline contract validation for the sandboxed plugin runtime.
 * Keep this separate from runtime orchestration so the lifecycle host remains
 * focused on iframe transport and request routing.
 */
export function buildQxPluginContractRuntime(
  manifestCommandNames: string[],
  manifestHasPanel: boolean,
): string {
  return `
      const manifestCommandNames = ${JSON.stringify(manifestCommandNames)};
      const manifestHasPanel = ${JSON.stringify(manifestHasPanel)};
      function validatePluginDefinition(value) {
        if (!value || typeof value !== 'object') throw new Error('QxPlugin export must be an object');
        const commands = Array.isArray(value.commands) ? value.commands : [], names = new Set();
        if (manifestHasPanel && (!value.panel || typeof value.panel.render !== 'function')) {
          throw new Error('Manifest panel requires QxPlugin.panel.render');
        }
        if (value.panel?.destroy != null && typeof value.panel.destroy !== 'function') {
          throw new Error('QxPlugin.panel.destroy must be a function');
        }
        for (const command of commands) {
          const name = String(command?.name || '').trim();
          if (!command || typeof command !== 'object' || !name) throw new Error('QxPlugin command requires a name');
          if (names.has(name)) throw new Error('Duplicate QxPlugin command: ' + name);
          names.add(name);
          if (typeof command.run !== 'function') throw new Error('QxPlugin command requires run: ' + name);
        }
        for (const name of manifestCommandNames) if (!names.has(name)) {
          throw new Error('Manifest command is missing from QxPlugin export: ' + name);
        }
        return value;
      }
    `;
}
