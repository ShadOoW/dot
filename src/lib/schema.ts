import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { PACKAGES_DIR } from "./config.ts";
import { listPackages } from "./pkg.ts";

// Canonical vocabularies. Anything outside these is reported by the validator
// so meta.json files can't silently drift (e.g. "darwin" vs "macos").
export const OS_VALUES = ["linux", "macos", "windows"] as const;
export const DISTROS = ["arch", "void", "macos", "linux"] as const;
export const PACKAGE_MANAGERS = ["brew", "xbps", "cargo", "pacman", "yay"] as const;
export const INIT_SYSTEMS = ["systemd", "runit", "launchd"] as const;
export const META_KEYS = [
  "description",
  "packages",
  "tags",
  "cleanSteps",
  "os",
  "hosts",
  "extends",
  "services",
] as const;

export type SchemaLevel = "error" | "warn";

export interface SchemaIssue {
  pkg: string;
  level: SchemaLevel;
  path: string;
  message: string;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * Validate one parsed meta.json against the canonical schema.
 * `knownPackages` enables cross-reference checks for `extends`; omit to skip them.
 */
export function validateMeta(
  raw: unknown,
  pkg: string,
  knownPackages?: Set<string>,
): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  const err = (path: string, message: string) => issues.push({ pkg, level: "error", path, message });
  const warn = (path: string, message: string) => issues.push({ pkg, level: "warn", path, message });

  if (!isObject(raw)) {
    err("", "meta.json must be a JSON object");
    return issues;
  }

  for (const key of Object.keys(raw)) {
    if (!(META_KEYS as readonly string[]).includes(key)) {
      warn(key, `unknown key "${key}" — ignored (valid: ${META_KEYS.join(", ")})`);
    }
  }

  if ("description" in raw && typeof raw.description !== "string") {
    err("description", "must be a string");
  }

  for (const key of ["tags", "cleanSteps", "os", "hosts", "extends"] as const) {
    if (key in raw && !isStringArray(raw[key])) {
      err(key, "must be an array of strings");
    }
  }

  if (isStringArray(raw.os)) {
    for (const v of raw.os) {
      if (v === "darwin") {
        err(`os`, `"darwin" is non-canonical — use "macos" to match detectDistro()`);
      } else if (!(OS_VALUES as readonly string[]).includes(v)) {
        err(`os`, `unknown OS "${v}" (valid: ${OS_VALUES.join(", ")})`);
      }
    }
  }

  if (isStringArray(raw.extends)) {
    for (const target of raw.extends) {
      if (target === pkg) err("extends", "a package cannot extend itself");
      else if (knownPackages && !knownPackages.has(target)) {
        err("extends", `extends unknown package "${target}"`);
      }
    }
  }

  if ("services" in raw) {
    if (!isObject(raw.services)) {
      err("services", "must be an object keyed by init system (systemd, runit, launchd)");
    } else {
      for (const [init, list] of Object.entries(raw.services)) {
        if (!(INIT_SYSTEMS as readonly string[]).includes(init)) {
          warn(`services.${init}`, `unknown init "${init}" (valid: ${INIT_SYSTEMS.join(", ")})`);
        }
        if (!Array.isArray(list)) {
          err(`services.${init}`, "must be an array of { name, scope? } entries");
          continue;
        }
        list.forEach((entry, i) => {
          if (!isObject(entry)) {
            err(`services.${init}[${i}]`, "must be an object with a name");
            return;
          }
          if (typeof entry.name !== "string") err(`services.${init}[${i}].name`, "must be a string");
          if ("scope" in entry && entry.scope !== "user" && entry.scope !== "system") {
            err(`services.${init}[${i}].scope`, 'must be "user" or "system"');
          }
        });
      }
    }
  }

  if ("packages" in raw) {
    if (!isObject(raw.packages)) {
      err("packages", "must be an object keyed by distro");
    } else {
      for (const [distro, list] of Object.entries(raw.packages)) {
        if (!(DISTROS as readonly string[]).includes(distro)) {
          warn(`packages.${distro}`, `unknown distro "${distro}" (valid: ${DISTROS.join(", ")})`);
        }
        if (!isObject(list)) {
          err(`packages.${distro}`, "must be an object keyed by package manager");
          continue;
        }
        for (const [pm, names] of Object.entries(list)) {
          if (!(PACKAGE_MANAGERS as readonly string[]).includes(pm)) {
            warn(`packages.${distro}.${pm}`, `unknown package manager "${pm}" (valid: ${PACKAGE_MANAGERS.join(", ")})`);
          }
          if (!isStringArray(names)) {
            err(`packages.${distro}.${pm}`, "must be an array of strings");
          }
        }
      }
    }
  }

  return issues;
}

/** Read and validate every package's meta.json. Packages without meta.json are skipped. */
export async function validateAllPackages(): Promise<SchemaIssue[]> {
  const names = await listPackages();
  const known = new Set(names);
  const issues: SchemaIssue[] = [];
  for (const name of names) {
    const metaPath = join(PACKAGES_DIR, name, "meta.json");
    if (!existsSync(metaPath)) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(metaPath, "utf-8"));
    } catch (e) {
      issues.push({ pkg: name, level: "error", path: "", message: `invalid JSON: ${(e as Error).message}` });
      continue;
    }
    issues.push(...validateMeta(raw, name, known));
  }
  return issues;
}
