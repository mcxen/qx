import type { ComponentType } from "react";
import { registerIslandComponent } from "../components/registry";
import type { IslandComponentProps } from "../components/registry";
import HomeSystemIsland from "../../home-island/modes/SystemIsland";
import HomeDateIsland from "../../home-island/modes/DateIsland";
import HomePulseIsland from "../../home-island/modes/PulseIsland";
import HomeCoreIsland from "../../home-island/modes/CoreIsland";
import HomeOrbitIsland from "../../home-island/modes/OrbitIsland";
import SearchProgressIsland from "../../launcher/SearchProgressIsland";
import type { HomeIslandAppearance } from "../../home-island/types";

let registered = false;

function wrapHome(
  Component: ComponentType<{
    appearance?: HomeIslandAppearance;
    showCpu?: boolean;
    showMemory?: boolean;
  }>,
  mode: "system" | "date" | "pulse" | "core" | "orbit",
): ComponentType<IslandComponentProps> {
  return function HomeIslandComponent(props: IslandComponentProps) {
    if (mode === "system") {
      return (
        <HomeSystemIsland
          showCpu={props.showCpu !== false}
          showMemory={props.showMemory !== false}
        />
      );
    }
    // Other modes take appearance via componentProps when needed
    const appearance = props.appearance as HomeIslandAppearance | undefined;
    return <Component appearance={appearance as HomeIslandAppearance} />;
  };
}

/** Idempotent registration of docked-only home island components. */
export function ensureHomeIslandComponents(): void {
  if (registered) return;
  registered = true;

  registerIslandComponent(
    "home.system",
    wrapHome(HomeSystemIsland as ComponentType<{ appearance?: HomeIslandAppearance }>, "system"),
  );
  registerIslandComponent(
    "home.date",
    wrapHome(HomeDateIsland as ComponentType<{ appearance?: HomeIslandAppearance }>, "date"),
  );
  registerIslandComponent(
    "home.pulse",
    wrapHome(HomePulseIsland as ComponentType<{ appearance?: HomeIslandAppearance }>, "pulse"),
  );
  registerIslandComponent(
    "home.core",
    wrapHome(HomeCoreIsland as ComponentType<{ appearance?: HomeIslandAppearance }>, "core"),
  );
  registerIslandComponent(
    "home.orbit",
    wrapHome(HomeOrbitIsland as ComponentType<{ appearance?: HomeIslandAppearance }>, "orbit"),
  );

  registerIslandComponent(
    "launcher.search-progress",
    SearchProgressIsland as ComponentType<IslandComponentProps>,
  );
}
