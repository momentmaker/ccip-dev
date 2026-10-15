/** Just enough of a DOM for React's client renderer to run in Node, so a test can mount a real tree and read what it shows. */
export class MiniNode {
  childNodes: MiniNode[] = [];
  parentNode: MiniNode | null = null;
  attributes: Record<string, string> = {};
  style: Record<string, unknown> & { setProperty(): void; removeProperty(): void } = { setProperty() {}, removeProperty() {} };
  nodeValue: string | null = null;

  constructor(
    readonly nodeType: number,
    readonly nodeName: string,
    readonly ownerDocument: MiniDocument,
  ) {}

  get tagName() {
    return this.nodeName;
  }
  get namespaceURI() {
    return 'http://www.w3.org/1999/xhtml';
  }
  get firstChild(): MiniNode | null {
    return this.childNodes[0] ?? null;
  }
  get lastChild(): MiniNode | null {
    return this.childNodes.at(-1) ?? null;
  }
  get nextSibling(): MiniNode | null {
    return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] ?? null;
  }
  get data() {
    return this.nodeValue;
  }
  set data(value: string | null) {
    this.nodeValue = value;
  }
  get textContent(): string {
    return this.nodeType === 3 ? (this.nodeValue ?? '') : this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(value: string) {
    this.childNodes = [];
    if (!value) return;
    const text = this.ownerDocument.createTextNode(value);
    this.appendChild(text);
  }

  appendChild(child: MiniNode) {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  insertBefore(child: MiniNode, before: MiniNode | null) {
    if (!before) return this.appendChild(child);
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    this.childNodes.splice(this.childNodes.indexOf(before), 0, child);
    return child;
  }
  removeChild(child: MiniNode) {
    this.childNodes = this.childNodes.filter((c) => c !== child);
    child.parentNode = null;
    return child;
  }
  setAttribute(name: string, value: unknown) {
    this.attributes[name] = String(value);
  }
  removeAttribute(name: string) {
    delete this.attributes[name];
  }
  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }
  hasAttribute(name: string) {
    return name in this.attributes;
  }
  addEventListener() {}
  removeEventListener() {}
  focus() {
    this.ownerDocument.activeElement = this;
  }

  find(match: (node: MiniNode) => boolean): MiniNode | null {
    if (match(this)) return this;
    for (const child of this.childNodes) {
      const found = child.find(match);
      if (found) return found;
    }
    return null;
  }

  /** What a tap does: React keeps each element's props on the node, and a button's tap is its onClick. */
  press() {
    const key = Object.keys(this).find((k) => k.startsWith('__reactProps$'));
    const props = (key ? (this as unknown as Record<string, { onClick?: (e: unknown) => void }>)[key] : undefined) ?? {};
    props.onClick?.({ preventDefault() {}, stopPropagation() {} });
  }
}

export class MiniDocument {
  nodeType = 9;
  visibilityState = 'visible';
  hidden = false;
  activeElement: MiniNode | null = null;
  defaultView: unknown = globalThis;
  addEventListener() {}
  removeEventListener() {}
  createElement(tag: string) {
    return new MiniNode(1, tag.toUpperCase(), this);
  }
  createElementNS(_namespace: string, tag: string) {
    return new MiniNode(1, tag.toUpperCase(), this);
  }
  createTextNode(text: string) {
    const node = new MiniNode(3, '#text', this);
    node.nodeValue = text;
    return node;
  }
}
