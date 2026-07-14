import { registerHomeIsland } from "./registry";
import { defaultHomeIsland } from "./modes/defaultMode";
import { systemHomeIsland } from "./modes/systemMode";
import { dateHomeIsland } from "./modes/dateMode";
import { pulseHomeIsland } from "./modes/pulseMode";
import { coreHomeIsland } from "./modes/coreMode";
import { orbitHomeIsland } from "./modes/orbitMode";

let registered = false;

/** Idempotent: register all built-in home island modes once. */
export function ensureHomeIslandCatalog(): void {
  if (registered) return;
  registerHomeIsland(defaultHomeIsland);
  registerHomeIsland(systemHomeIsland);
  registerHomeIsland(dateHomeIsland);
  registerHomeIsland(pulseHomeIsland);
  registerHomeIsland(coreHomeIsland);
  registerHomeIsland(orbitHomeIsland);
  registered = true;
}
