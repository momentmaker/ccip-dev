export interface VNode {
  type: string;
  props: Record<string, unknown>;
}

type Child = VNode | string | number | null | false | undefined;

export function h(type: string, props: Record<string, unknown> | null, ...children: Child[]): VNode {
  const kids = children.filter((c): c is VNode | string | number => c !== null && c !== false && c !== undefined);
  return { type, props: { ...(props ?? {}), ...(kids.length === 0 ? {} : { children: kids.length === 1 ? kids[0] : kids }) } };
}
