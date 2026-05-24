export type UpdaterGroup = "system" | "global" | "source";

export interface Updater {
  name: string;
  group: UpdaterGroup;
  run: (check: boolean) => Promise<boolean>;
}
