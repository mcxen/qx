import { invoke } from "@tauri-apps/api/core";

export interface QxAiSkillSummary {
  id: string;
  name: string;
  description: string;
  path: string;
}

export interface QxAiSkillDocument extends QxAiSkillSummary {
  content: string;
}

export async function listQxAiSkills(): Promise<QxAiSkillSummary[]> {
  return invoke<QxAiSkillSummary[]>("qxai_list_skills");
}

export async function readQxAiSkill(id: string): Promise<QxAiSkillDocument> {
  return invoke<QxAiSkillDocument>("qxai_read_skill", { id });
}

export async function openQxAiSkillsDirectory(): Promise<void> {
  const path = await invoke<string>("qxai_skills_directory");
  await invoke("plugin_system_open_path", { path });
}

function fuzzyScore(value: string, query: string): number | null {
  const haystack = value.toLocaleLowerCase();
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return 0;
  const exact = haystack.indexOf(needle);
  if (exact >= 0) return exact;
  let cursor = 0;
  let score = 100;
  for (const character of needle) {
    const found = haystack.indexOf(character, cursor);
    if (found < 0) return null;
    score += found - cursor;
    cursor = found + 1;
  }
  return score;
}

export function filterQxAiSkills(
  skills: QxAiSkillSummary[],
  query: string,
): QxAiSkillSummary[] {
  return skills
    .map((skill) => ({
      skill,
      score: fuzzyScore(`${skill.name} ${skill.id} ${skill.description}`, query),
    }))
    .filter((entry): entry is { skill: QxAiSkillSummary; score: number } => entry.score !== null)
    .sort((left, right) => left.score - right.score || left.skill.name.localeCompare(right.skill.name))
    .map((entry) => entry.skill);
}
