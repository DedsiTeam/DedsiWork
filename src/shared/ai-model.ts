// The application default. Change this entry to update all AI model selectors
// and new server-side calls; explicit selections and existing chats take priority.
export const DEFAULT_AI_MODEL = {
  id: "gpt-6.1-sol",
  name: "GPT-6.1-Sol",
} as const;

export function resolveAIModel(model?: string | null): string {
  return model?.trim() || DEFAULT_AI_MODEL.id;
}

type AIModelOption = { id: string; name: string };
export function aiModelOptions(
  models: readonly AIModelOption[] = [],
  selected?: string | null,
): AIModelOption[] {
  const options: AIModelOption[] = [
    DEFAULT_AI_MODEL,
    ...models.filter((model) => model.id !== DEFAULT_AI_MODEL.id),
  ];
  // A saved chat may use a model that is no longer listed in the catalog.
  if (selected && !options.some((model) => model.id === selected))
    options.push({ id: selected, name: selected });
  return options;
}
