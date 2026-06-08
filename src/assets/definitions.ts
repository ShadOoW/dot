import { join } from "path";
import { HOME_DIR } from "../lib/config.ts";
import { downloadAndExtract, gitCloneOrPull, gitInstallerSync, type LogFn } from "../lib/downloader.ts";
import { getLatestRelease, findAsset } from "../lib/github.ts";
import { logInfo, commandExists } from "../lib/console.ts";

export type { LogFn };

export type ReleaseAsset = {
  kind: "release";
  name: string;
  description: string;
  repo: string;
  filePattern: RegExp;
  installDir: string;
  sudo?: boolean;
  postInstall?: (log?: LogFn) => Promise<void>;
};

export type ReleaseTarballAsset = {
  kind: "release-tarball";
  name: string;
  description: string;
  repo: string;
  installDir: string;
  sudo?: boolean;
  postInstall?: (log?: LogFn) => Promise<void>;
};

export type GitInstallerAsset = {
  kind: "git-installer";
  name: string;
  description: string;
  remote: string;
  installDir: string;
  installCmd: string[];
  sudo?: boolean;
  postInstall?: (log?: LogFn) => Promise<void>;
};

export type UrlAsset = {
  kind: "url";
  name: string;
  description: string;
  downloadUrl: string;
  version: string;
  installDir: string;
  sudo?: boolean;
  postInstall?: (log?: LogFn) => Promise<void>;
};

export type GitAsset = {
  kind: "git";
  name: string;
  description: string;
  remote: string;
  installDir: string;
  sudo?: boolean;
};

export type MultiUrlAsset = {
  kind: "multi-url";
  name: string;
  description: string;
  urls: string[];
  version: string;
  installDir: string;
  sudo?: boolean;
  postInstall?: (log?: LogFn) => Promise<void>;
};

export type AssetDef =
  | ReleaseAsset
  | ReleaseTarballAsset
  | GitInstallerAsset
  | UrlAsset
  | GitAsset
  | MultiUrlAsset;

const fontsDir = join(HOME_DIR, ".local/share/fonts");
const iconsDir = join(HOME_DIR, ".local/share/icons");
const binDir = join(HOME_DIR, ".local/bin");

const refreshFontCache = async (log: LogFn = logInfo) => {
  if (commandExists("fc-cache")) {
    log("Refreshing font cache…");
    Bun.spawnSync(["fc-cache", "-fv"], { stdout: "ignore", stderr: "ignore" });
  }
};

const makeExecutable = async (file: string, log: LogFn = logInfo) => {
  log(`Making executable: ${file}`);
  Bun.spawnSync(["chmod", "+x", file]);
};

export async function syncAsset(asset: AssetDef, log: LogFn = logInfo): Promise<void> {
  if (asset.kind === "git-installer") {
    await gitInstallerSync(asset.remote, asset.installDir, asset.installCmd, asset.sudo, log);
    if (asset.postInstall) await asset.postInstall(log);
    return;
  }

  if (asset.kind === "git") {
    await gitCloneOrPull(asset.remote, asset.installDir, asset.sudo, log);
    return;
  }

  if (asset.kind === "url") {
    await downloadAndExtract(asset.downloadUrl, asset.installDir, asset.sudo, 0, log);
    if (asset.postInstall) await asset.postInstall(log);
    return;
  }

  if (asset.kind === "multi-url") {
    for (const url of asset.urls) {
      await downloadAndExtract(url, asset.installDir, asset.sudo, 0, log);
    }
    if (asset.postInstall) await asset.postInstall(log);
    return;
  }

  const release = await getLatestRelease(asset.repo);
  if (!release) throw new Error(`Could not fetch release for ${asset.repo}`);

  if (asset.kind === "release") {
    const file = findAsset(release, asset.filePattern);
    if (!file) throw new Error(`No matching asset in ${asset.repo} release ${release.tag_name}`);
    await downloadAndExtract(file.browser_download_url, asset.installDir, asset.sudo, 0, log);
  } else if (asset.kind === "release-tarball") {
    await downloadAndExtract(release.tarball_url, asset.installDir, asset.sudo, 1, log);
  }

  if (asset.postInstall) await asset.postInstall(log);
}


export const ASSETS: AssetDef[] = [
  {
    kind: "release",
    name: "JetBrainsMono",
    description: "JetBrains Mono Nerd Font",
    repo: "ryanoasis/nerd-fonts",
    filePattern: /^JetBrainsMono\.tar\.xz$/i,
    installDir: join(fontsDir, "JetBrainsMono"),
    postInstall: refreshFontCache,
  },
  {
    kind: "release",
    name: "Terminus",
    description: "Terminus Nerd Font (bitmap terminal font)",
    repo: "ryanoasis/nerd-fonts",
    filePattern: /^Terminus\.tar\.xz$/i,
    installDir: join(fontsDir, "Terminus"),
    postInstall: refreshFontCache,
  },
  {
    kind: "url",
    name: "NotoSansCJK",
    description: "Noto Sans CJK (Chinese, Japanese, Korean)",
    downloadUrl: "https://github.com/notofonts/noto-cjk/releases/download/Sans2.004/00_NotoSansCJK.ttc.zip",
    version: "Sans2.004",
    installDir: join(fontsDir, "NotoSansCJK"),
    postInstall: refreshFontCache,
  },
  {
    kind: "release",
    name: "Inter",
    description: "Inter variable font family",
    repo: "rsms/inter",
    filePattern: /^Inter-[\d.]+\.zip$/i,
    installDir: join(fontsDir, "Inter"),
    postInstall: refreshFontCache,
  },
  {
    kind: "url",
    name: "NotoColorEmoji",
    description: "Noto Color Emoji",
    downloadUrl: "https://raw.githubusercontent.com/googlefonts/noto-emoji/v2.051/fonts/NotoColorEmoji.ttf",
    version: "v2.051",
    installDir: join(fontsDir, "NotoColorEmoji"),
    postInstall: refreshFontCache,
  },
  {
    kind: "url",
    name: "NotoSansArabic",
    description: "Noto Sans Arabic (all weights and widths)",
    downloadUrl: "https://github.com/notofonts/arabic/releases/download/NotoSansArabic-v2.013/NotoSansArabic-v2.013.zip",
    version: "NotoSansArabic-v2.013",
    installDir: join(fontsDir, "NotoSansArabic"),
    postInstall: refreshFontCache,
  },
  {
    kind: "release-tarball",
    name: "Papirus",
    description: "Papirus icon theme",
    repo: "PapirusDevelopmentTeam/papirus-icon-theme",
    installDir: iconsDir,
  },
  {
    kind: "release-tarball",
    name: "papirus-folders",
    description: "Papirus folder color tool",
    repo: "PapirusDevelopmentTeam/papirus-folders",
    installDir: binDir,
    postInstall: (log) => makeExecutable(join(binDir, "papirus-folders"), log),
  },
  {
    kind: "git-installer",
    name: "Tokyonight-GTK",
    description: "Tokyonight GTK3 theme + libadwaita (GTK4/Nautilus) + matching icon theme",
    remote: "https://github.com/Fausto-Korpsvart/Tokyonight-GTK-Theme.git",
    installDir: join(HOME_DIR, ".local/share/tokyonight-gtk"),
    installCmd: [
      "git submodule update --init --recursive",
      // GTK3 theme + --libadwaita links the gtk-4.0 theme into ~/.config so
      // libadwaita apps (Nautilus) follow it instead of generic Adwaita-dark.
      "cd themes && ./install.sh --color dark --theme default --libadwaita --dest ~/.local/share/themes",
      // Icon themes ship as ready dirs (no installer) — symlink into ~/.local/share/icons
      // (symlink, not copy: keeps a single 161M source updated by `git pull`).
      'mkdir -p ~/.local/share/icons && ln -sfn "$PWD/icons/Tokyonight-Dark" ~/.local/share/icons/Tokyonight-Dark && ln -sfn "$PWD/icons/Tokyonight-Dark-Cyan" ~/.local/share/icons/Tokyonight-Dark-Cyan',
    ],
  },
  {
    kind: "release",
    name: "Bibata-cursor",
    description: "Bibata Modern Classic cursor theme",
    repo: "ful1e5/Bibata_Cursor",
    filePattern: /^Bibata-Modern-Classic\.tar\.xz$/i,
    installDir: join(iconsDir, "Bibata-Modern-Classic"),
  },
];
