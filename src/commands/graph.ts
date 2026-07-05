import { defineCommand } from "citty";
import { writeFile } from "fs/promises";
import { join } from "path";
import { PACKAGES_DIR } from "../lib/config.ts";
import { appliesToHost, collectFiles, detectHost, detectInit, getPackageMeta, listPackages } from "../lib/pkg.ts";
import { serviceStatus, type Init } from "../lib/service.ts";
import { colors, logError, logInfo } from "../lib/console.ts";

interface PkgNode {
  name: string;
  tags: string[];
  hosts: string[];
  extends: string[];
  services: string[];
  fileCount: number;
}

async function buildNodes(init: Init): Promise<PkgNode[]> {
  const names = await listPackages();
  const nodePromises = names.map(async (name) => {
    const meta = await getPackageMeta(name);
    if (!meta) return null;
    const pkgDir = join(PACKAGES_DIR, name);
    const [home, system, services] = await Promise.all([
      collectFiles(pkgDir, "home"),
      collectFiles(pkgDir, "system", init),
      serviceStatus(name, init),
    ]);
    return {
      name,
      tags: meta.tags,
      hosts: meta.hosts,
      extends: meta.extends,
      services: services.map((s) => s.name),
      fileCount: home.length + system.length,
    };
  });
  const nodes = (await Promise.all(nodePromises)).filter((n): n is PkgNode => n !== null);
  return nodes;
}

const sid = (prefix: string, s: string) => `${prefix}_${s.replace(/[^a-zA-Z0-9]/g, "_")}`;

function toMermaid(nodes: PkgNode[]): string {
  const lines = ["graph LR"];
  const tagSeen = new Set<string>();
  const hostSeen = new Set<string>();
  let untagged = false;

  for (const n of nodes) {
    const p = sid("p", n.name);
    lines.push(`  ${p}["${n.name}"]`);
    if (n.tags.length === 0) {
      lines.push(`  ${p} -.-> UNTAGGED((untagged))`);
      untagged = true;
    }
    for (const t of n.tags) {
      const tn = sid("t", t);
      if (!tagSeen.has(t)) { lines.push(`  ${tn}(["#${t}"])`); tagSeen.add(t); }
      lines.push(`  ${p} --> ${tn}`);
    }
    for (const h of n.hosts) {
      const hn = sid("h", h);
      if (!hostSeen.has(h)) { lines.push(`  ${hn}{{"${h}"}}`); hostSeen.add(h); }
      lines.push(`  ${p} -.->|host| ${hn}`);
    }
    for (const e of n.extends) {
      lines.push(`  ${p} ==>|extends| ${sid("p", e)}`);
    }
    for (const s of n.services) {
      lines.push(`  ${p} --> ${sid("s", n.name + "_" + s)}[["${s}"]]`);
    }
  }
  if (untagged) lines.push("  classDef warn fill:#fdd,stroke:#c00;", "  class UNTAGGED warn;");
  return lines.join("\n");
}

function toDot(nodes: PkgNode[]): string {
  const lines = ["digraph dot {", "  rankdir=LR;", "  node [shape=box];"];
  for (const n of nodes) {
    const q = JSON.stringify(n.name);
    if (n.tags.length === 0) lines.push(`  ${q} -> "untagged" [style=dotted];`);
    for (const t of n.tags) lines.push(`  ${q} -> ${JSON.stringify("#" + t)};`);
    for (const h of n.hosts) lines.push(`  ${q} -> ${JSON.stringify("@" + h)} [style=dashed,label="host"];`);
    for (const e of n.extends) lines.push(`  ${q} -> ${JSON.stringify(e)} [style=bold,label="extends"];`);
    for (const s of n.services) lines.push(`  ${q} -> ${JSON.stringify("svc:" + s)} [label="service"];`);
  }
  lines.push(`  ${JSON.stringify("#untagged" )} [shape=ellipse,style=filled,fillcolor="#fdd"];`);
  lines.push("}");
  return lines.join("\n");
}

function toText(nodes: PkgNode[]): string {
  const byTag = new Map<string, string[]>();
  const untagged: string[] = [];
  for (const n of nodes) {
    if (n.tags.length === 0) untagged.push(n.name);
    for (const t of n.tags) (byTag.get(t) ?? byTag.set(t, []).get(t)!).push(n.name);
  }
  const lines: string[] = [];
  for (const tag of [...byTag.keys()].sort()) {
    lines.push(colors.cyan(`#${tag}`) + colors.dim(` (${byTag.get(tag)!.length})`));
    lines.push("  " + byTag.get(tag)!.sort().join("  "));
  }
  if (untagged.length > 0) {
    lines.push("");
    lines.push(colors.yellow(`untagged (${untagged.length}) — not reachable via --tag`));
    lines.push("  " + untagged.sort().join("  "));
  }
  return lines.join("\n");
}

function impactReport(nodes: PkgNode[], tag: string, host: string): string {
  const matched = nodes.filter((n) => n.tags.includes(tag));
  if (matched.length === 0) return colors.yellow(`No packages carry tag "${tag}".`);

  const included = matched.filter((n) => appliesToHost({ hosts: n.hosts }, host));
  const excluded = matched.filter((n) => !appliesToHost({ hosts: n.hosts }, host));

  const lines: string[] = [];
  lines.push(`${colors.bold(`Impact of \`dot link --tag ${tag}\``)} ${colors.dim(`on host ${host}`)}\n`);

  let files = 0;
  let svc = 0;
  lines.push(colors.green(`Would link (${included.length} package(s)):`));
  for (const n of included.sort((a, b) => a.name.localeCompare(b.name))) {
    files += n.fileCount;
    svc += n.services.length;
    const svcNote = n.services.length ? colors.dim(`  services: ${n.services.join(", ")}`) : "";
    lines.push(`  ${colors.bold(n.name.padEnd(18))} ${String(n.fileCount).padStart(3)} file(s)${svcNote}`);
  }

  if (excluded.length > 0) {
    lines.push(`\n${colors.dim(`Excluded by host filter (${excluded.length}):`)}`);
    for (const n of excluded.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`  ${colors.dim(n.name.padEnd(18))} ${colors.dim(`hosts=[${n.hosts.join(", ")}]`)}`);
    }
  }

  lines.push("");
  lines.push(colors.dim(`Total: ${files} file(s), ${svc} service(s) across ${included.length} package(s)`));
  return lines.join("\n");
}

export const graphCommand = defineCommand({
  meta: { description: "Visualize packages, tags, hosts, and services (Mermaid/DOT/text)" },
  args: {
    format: { type: "string", description: "Output format: mermaid (default), dot, or text" },
    impact: { type: "string", description: "Show what `dot link --tag <tag>` would touch on this host" },
    out: { type: "string", description: "Write to a file instead of stdout" },
  },
  async run({ args }) {
    const init = detectInit() ?? "systemd";
    const format = args.format ?? (args.impact ? "text" : "mermaid");
    if (!["mermaid", "dot", "text"].includes(format)) {
      logError(`Unknown format "${format}". Valid: mermaid, dot, text`);
      process.exit(1);
    }

    const nodes = await buildNodes(init);
    const render = (ns: PkgNode[]) =>
      format === "dot" ? toDot(ns) : format === "text" ? toText(ns) : toMermaid(ns);

    let output: string;
    if (args.impact) {
      output = format === "text"
        ? impactReport(nodes, args.impact, detectHost())
        : render(nodes.filter((n) => n.tags.includes(args.impact!)));
    } else {
      output = render(nodes);
    }

    if (args.out) {
      await writeFile(args.out, output + "\n");
      logInfo(`Wrote ${format} graph to ${args.out}`);
    } else {
      console.log(output);
    }
  },
});
