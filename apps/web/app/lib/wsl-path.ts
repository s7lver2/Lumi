// apps/web/app/lib/wsl-path.ts
/**
 * Translates a Windows absolute path (e.g. "E:\Lumi\services\inference") into
 * its WSL2 mount-point equivalent ("/mnt/e/Lumi/services/inference"), so the
 * setup wizard's optional WSL2 install path can `cd` into the same repo
 * checkout from inside the Linux distro instead of assuming a second clone.
 */
export function winPathToWsl(winPath: string): string {
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(winPath);
  if (!match) {
    throw new Error(`Not an absolute Windows path: ${winPath}`);
  }
  const [, drive, rest] = match;
  const posixRest = rest.replace(/\\/g, "/");
  return `/mnt/${drive.toLowerCase()}/${posixRest}`;
}
