export type Scope = {
  param: Record<string, string>
  item: Record<string, string>
  files: Record<string, string>
}

const PLACEHOLDER = /\{\{\s*(param|item|files)\.([^}]+?)\s*\}\}/g

/** Replaces {{param.x}}, {{item.Column}} and {{files.name}}; throws on any unknown reference. */
export function render(template: string, scope: Scope): string {
  return template.replace(PLACEHOLDER, (_, ns: keyof Scope, key: string) => {
    const value = scope[ns][key]
    if (value === undefined) throw new Error(`Unknown ${ns}.${key} in "${template}"`)
    return value
  })
}

export function references(template: string): { ns: keyof Scope; key: string }[] {
  return [...template.matchAll(PLACEHOLDER)].map((m) => ({ ns: m[1] as keyof Scope, key: m[2] as string }))
}
