/**
 * Legacy list-only entry. QxAI now uses a master–detail workbench
 * (`QxAiChat`): left conversation list + right chat surface.
 * Kept so older imports and module-port checks resolve cleanly.
 */
export { default } from "./QxAiChat";
