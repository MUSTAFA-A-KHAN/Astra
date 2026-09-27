// Packages the game as an installable Android app: builds the static site,
// wraps it in the android/ project and leaves the APK in dist/.
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const android = resolve(root, 'android');
const windows = process.platform === 'win32';

function run(command, args, cwd) {
  // Windows can only start the Gradle wrapper (a .bat) through a shell, which
  // takes a single command line.
  const result = command.endsWith('.bat')
    ? spawnSync(`"${command}" ${args.join(' ')}`, { cwd, stdio: 'inherit', shell: true })
    : spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, ['tools/build.mjs'], root);
run(windows ? resolve(android, 'gradlew.bat') : './gradlew', ['assembleRelease'], android);

const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const apk = resolve(root, 'dist', `astra-${version}.apk`);
await mkdir(dirname(apk), { recursive: true });
await copyFile(resolve(android, 'build/outputs/apk/release/astra-release.apk'), apk);
console.log(`Android app packaged in ${relative(root, apk)}`);
