// electron-builder afterPack hook: builds the native widget and embeds it in the .app before the dmg and zip are made.
// On a widget build failure the app is still produced (without the widget) and the problem is printed loudly.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.platform !== 'darwin') { console.warn('[widget] skipped: native widgets can only be built on macOS'); return; }
  const arch = { 1: 'x86_64', 3: 'arm64' }[context.arch];
  if (!arch) { console.warn('[widget] skipped: unsupported architecture', context.arch); return; }
  const app = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app');
  const work = path.join(context.appOutDir, '..', 'widget-build-' + arch);
  try {
    fs.mkdirSync(work, { recursive: true });
    execFileSync(path.join(__dirname, '..', 'native-widget', 'build.sh'), [arch, work, context.packager.appInfo.version], { stdio: 'inherit' });
    const plugins = path.join(app, 'Contents', 'PlugIns');
    fs.mkdirSync(plugins, { recursive: true });
    fs.rmSync(path.join(plugins, 'TallyWidget.appex'), { recursive: true, force: true });
    execFileSync('ditto', [path.join(work, 'TallyWidget.appex'), path.join(plugins, 'TallyWidget.appex')], { stdio: 'inherit' });
    // The app's signature seal covers its contents, so seal it again (ad hoc, not --deep, so the widget keeps its own entitlements).
    execFileSync('codesign', ['--force', '--sign', process.env.WIDGET_SIGN_IDENTITY || '-', app], { stdio: 'inherit' });
    execFileSync('codesign', ['--verify', '--strict', app], { stdio: 'inherit' });
    console.log('[widget] embedded in', app);
  } catch (e) {
    console.error('\n[widget] WARNING: the native widget was NOT added to this build:', e.message, '\n');
    fs.rmSync(path.join(app, 'Contents', 'PlugIns', 'TallyWidget.appex'), { recursive: true, force: true });
  }
};
