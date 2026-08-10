// Minimal i3-ipc client for sway over $SWAYSOCK.
// Framing: "i3-ipc" magic, u32-LE payload length, u32-LE message type, JSON
// payload. Event messages set the high bit of the type field.

const MAGIC = "i3-ipc";
const HEADER_LEN = MAGIC.length + 8;

export const enum IpcType {
  RUN_COMMAND = 0,
  GET_WORKSPACES = 1,
  SUBSCRIBE = 2,
  GET_TREE = 4,
}

export interface SwayNode {
  id: number;
  type: "root" | "output" | "workspace" | "con" | "floating_con";
  name: string | null;
  app_id?: string | null;
  pid?: number;
  marks?: string[];
  num?: number;
  focused?: boolean;
  /** Container split kind: splith, splitv, tabbed, stacked, or none for leaves. */
  layout?: string;
  /** Absolute geometry; a child's share of its parent's rect is how ppt is recovered. */
  rect?: { x: number; y: number; width: number; height: number };
  window_properties?: { class?: string; instance?: string };
  nodes?: SwayNode[];
  floating_nodes?: SwayNode[];
}

export interface WindowEvent {
  change: string;
  container: SwayNode;
}

export interface CommandResult {
  success: boolean;
  error?: string;
}

interface IpcMessage {
  type: number;
  payload: unknown;
}

function socketPath(): string {
  const p = process.env.SWAYSOCK ?? process.env.I3SOCK;
  if (!p) throw new Error("SWAYSOCK is not set — not inside a sway session?");
  return p;
}

function encode(type: number, payload: string): Uint8Array {
  const body = new TextEncoder().encode(payload);
  const buf = new Uint8Array(HEADER_LEN + body.length);
  buf.set(new TextEncoder().encode(MAGIC), 0);
  const dv = new DataView(buf.buffer);
  dv.setUint32(6, body.length, true);
  dv.setUint32(10, type, true);
  buf.set(body, HEADER_LEN);
  return buf;
}

class SwayIpc {
  private buffer = new Uint8Array(0);
  private inbox: IpcMessage[] = [];
  private waiter: ((m: IpcMessage | null) => void) | null = null;
  private sock: Awaited<ReturnType<typeof Bun.connect>> | null = null;
  private dead = false;

  async connect(): Promise<void> {
    this.sock = await Bun.connect({
      unix: socketPath(),
      socket: {
        data: (_s, chunk) => this.feed(chunk),
        close: () => this.drop(),
        error: () => this.drop(),
      },
    });
  }

  send(type: IpcType, payload = ""): void {
    this.sock?.write(encode(type, payload));
  }

  /** Next framed message, or null on timeout / closed connection. */
  next(timeoutMs: number): Promise<IpcMessage | null> {
    const queued = this.inbox.shift();
    if (queued) return Promise.resolve(queued);
    if (this.dead) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.waiter === settle) this.waiter = null;
        resolve(null);
      }, timeoutMs);
      const settle = (m: IpcMessage | null) => {
        clearTimeout(timer);
        resolve(m);
      };
      this.waiter = settle;
    });
  }

  close(): void {
    this.sock?.end();
    this.drop();
  }

  private drop(): void {
    this.dead = true;
    this.waiter?.(null);
    this.waiter = null;
  }

  private feed(chunk: Uint8Array): void {
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;
    for (;;) {
      if (this.buffer.length < HEADER_LEN) return;
      const dv = new DataView(this.buffer.buffer, this.buffer.byteOffset);
      const len = dv.getUint32(6, true);
      const type = dv.getUint32(10, true);
      if (this.buffer.length < HEADER_LEN + len) return;
      const body = this.buffer.slice(HEADER_LEN, HEADER_LEN + len);
      this.buffer = this.buffer.slice(HEADER_LEN + len);
      let payload: unknown = null;
      try {
        payload = JSON.parse(new TextDecoder().decode(body));
      } catch {
        // sway always sends JSON; treat garbage as an opaque message
      }
      const msg = { type, payload };
      if (this.waiter) {
        const w = this.waiter;
        this.waiter = null;
        w(msg);
      } else {
        this.inbox.push(msg);
      }
    }
  }
}

async function request(type: IpcType, payload = ""): Promise<unknown> {
  const ipc = new SwayIpc();
  await ipc.connect();
  try {
    ipc.send(type, payload);
    const reply = await ipc.next(5000);
    if (!reply) throw new Error(`sway IPC request ${type} timed out`);
    return reply.payload;
  } finally {
    ipc.close();
  }
}

export async function swayCommand(cmd: string): Promise<CommandResult[]> {
  return (await request(IpcType.RUN_COMMAND, cmd)) as CommandResult[];
}

export async function getTree(): Promise<SwayNode> {
  return (await request(IpcType.GET_TREE)) as SwayNode;
}

export function* allNodes(root: SwayNode): Generator<SwayNode> {
  yield root;
  for (const child of [...(root.nodes ?? []), ...(root.floating_nodes ?? [])]) {
    yield* allNodes(child);
  }
}

/** Leaf containers (actual windows) with the workspace node that owns them. */
export function* walkTree(
  root: SwayNode,
  workspace: SwayNode | null = null,
): Generator<{ node: SwayNode; workspace: SwayNode | null }> {
  const ws = root.type === "workspace" ? root : workspace;
  const children = [...(root.nodes ?? []), ...(root.floating_nodes ?? [])];
  if (children.length === 0) {
    if (root.type === "con" || root.type === "floating_con") yield { node: root, workspace: ws };
    return;
  }
  for (const child of children) yield* walkTree(child, ws);
}

export async function findByMark(mark: string): Promise<SwayNode | null> {
  for (const n of allNodes(await getTree())) {
    if (n.marks?.includes(mark)) return n;
  }
  return null;
}

export async function findByAppIdPrefix(prefix: string): Promise<SwayNode[]> {
  return [...allNodes(await getTree())].filter((n) => n.app_id?.startsWith(prefix));
}

/**
 * Long-lived subscription to window events. Open it BEFORE spawning the app
 * you intend to wait for — events buffer in the inbox, and waitFor() also
 * checks the current tree, so the appear-before-wait race is closed.
 */
export class WindowSubscription {
  private constructor(private ipc: SwayIpc) {}

  static async open(): Promise<WindowSubscription> {
    const ipc = new SwayIpc();
    await ipc.connect();
    ipc.send(IpcType.SUBSCRIBE, JSON.stringify(["window"]));
    const ack = await ipc.next(5000);
    if (!ack || (ack.payload as { success?: boolean })?.success !== true) {
      ipc.close();
      throw new Error("sway IPC subscribe failed");
    }
    return new WindowSubscription(ipc);
  }

  /** Resolve when a window with this exact app_id exists; null on timeout. */
  async waitFor(appId: string, timeoutMs = 15000): Promise<SwayNode | null> {
    const existing = (await findByAppIdPrefix(appId)).find((n) => n.app_id === appId);
    if (existing) return existing;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      const msg = await this.ipc.next(remaining);
      if (!msg) return null;
      if (msg.type >>> 31 !== 1) continue; // request reply, not an event
      const ev = msg.payload as WindowEvent | null;
      if (ev?.change === "new" && ev.container?.app_id === appId) return ev.container;
    }
  }

  close(): void {
    this.ipc.close();
  }
}
