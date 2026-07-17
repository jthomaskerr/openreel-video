import type {
  EditorConfig,
  LexicalNode,
  NodeKey,
  SerializedTextNode,
  Spread,
} from "lexical";
import { TextNode } from "lexical";

export type MentionKind = "character" | "media";
export type MentionStatus = "active" | "unresolved" | "unavailable";

export interface MentionNodePayload {
  readonly kind: MentionKind;
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly canonicalToken: string;
  readonly available: boolean;
  readonly status: MentionStatus;
  readonly message?: string;
}

export type SerializedMentionNode = Spread<
  {
    readonly type: "mention";
    readonly version: 1;
    readonly kind: MentionKind;
    readonly mentionId: string;
    readonly label: string;
    readonly description: string;
    readonly canonicalToken: string;
    readonly available: boolean;
    readonly status: MentionStatus;
    readonly message?: string;
  },
  SerializedTextNode
>;

function displayLabel(label: string): string {
  return label.startsWith("@") ? label : `@${label}`;
}

function applyMentionDomAttributes(
  dom: HTMLElement,
  mention: MentionNode,
): void {
  const status = mention.getStatus();
  const message = mention.getMessage();
  const label = mention.getLabel();

  dom.dataset.mentionNode = "true";
  dom.dataset.mentionKind = mention.getMentionKind();
  dom.dataset.mentionId = mention.getMentionId();
  dom.dataset.mentionToken = mention.getCanonicalToken();
  dom.dataset.status = status;
  dom.setAttribute("role", "button");
  dom.setAttribute("tabindex", "-1");
  dom.setAttribute(
    "aria-label",
    status === "active" ? `${label} reference` : message ?? `${label} reference`,
  );
  dom.className = [
    "inline-flex items-center rounded-full border px-1.5 py-0.5 align-baseline text-xs font-medium",
    status === "active"
      ? "border-primary/40 bg-primary/10 text-text-primary"
      : "border-destructive/40 bg-destructive/10 text-destructive",
  ].join(" ");
}

export class MentionNode extends TextNode {
  __kind: MentionKind;
  __mentionId: string;
  __label: string;
  __description: string;
  __canonicalToken: string;
  __available: boolean;
  __status: MentionStatus;
  __message?: string;

  static getType(): string {
    return "mention";
  }

  static clone(node: MentionNode): MentionNode {
    const clone = new MentionNode(
      {
        kind: node.__kind,
        id: node.__mentionId,
        label: node.__label,
        description: node.__description,
        canonicalToken: node.__canonicalToken,
        available: node.__available,
        status: node.__status,
        message: node.__message,
      },
      node.__text,
      node.__key,
    );
    clone.__format = node.__format;
    clone.__detail = node.__detail;
    clone.__mode = node.__mode;
    clone.__style = node.__style;
    return clone;
  }

  static importJSON(serializedNode: SerializedMentionNode): MentionNode {
    return $createMentionNode({
      kind: serializedNode.kind,
      id: serializedNode.mentionId,
      label: serializedNode.label,
      description: serializedNode.description,
      canonicalToken: serializedNode.canonicalToken,
      available: serializedNode.available,
      status: serializedNode.status,
      message: serializedNode.message,
    });
  }

  constructor(
    payload: MentionNodePayload,
    text = displayLabel(payload.label),
    key?: NodeKey,
  ) {
    super(text, key);
    this.__kind = payload.kind;
    this.__mentionId = payload.id;
    this.__label = payload.label;
    this.__description = payload.description;
    this.__canonicalToken = payload.canonicalToken;
    this.__available = payload.available;
    this.__status = payload.status;
    this.__message = payload.message;
    this.__mode = 1;
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config);
    applyMentionDomAttributes(dom, this);
    return dom;
  }

  updateDOM(
    prevNode: this,
    dom: HTMLElement,
    config: EditorConfig,
  ): boolean {
    const updated = super.updateDOM(prevNode, dom, config);
    applyMentionDomAttributes(dom, this);
    return updated;
  }

  exportJSON(): SerializedMentionNode {
    return {
      ...super.exportJSON(),
      type: "mention",
      version: 1,
      kind: this.getMentionKind(),
      mentionId: this.getMentionId(),
      label: this.getLabel(),
      description: this.getDescription(),
      canonicalToken: this.getCanonicalToken(),
      available: this.isAvailable(),
      status: this.getStatus(),
      message: this.getMessage(),
    };
  }

  canInsertTextBefore(): boolean {
    return false;
  }

  canInsertTextAfter(): boolean {
    return false;
  }

  isTextEntity(): boolean {
    return true;
  }

  getMentionKind(): MentionKind {
    return this.getLatest().__kind;
  }

  getMentionId(): string {
    return this.getLatest().__mentionId;
  }

  getLabel(): string {
    return this.getLatest().__label;
  }

  getDescription(): string {
    return this.getLatest().__description;
  }

  getCanonicalToken(): string {
    return this.getLatest().__canonicalToken;
  }

  isAvailable(): boolean {
    return this.getLatest().__available;
  }

  getStatus(): MentionStatus {
    return this.getLatest().__status;
  }

  getMessage(): string | undefined {
    return this.getLatest().__message;
  }
}

export function $createMentionNode(payload: MentionNodePayload): MentionNode {
  const node = new MentionNode(payload);
  node.setMode("token");
  return node;
}

export function $isMentionNode(
  node: LexicalNode | null | undefined,
): node is MentionNode {
  return node instanceof MentionNode;
}
