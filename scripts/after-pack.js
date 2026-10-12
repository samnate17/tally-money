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
    // Native Liquid Glass addon for the main window (macOS 26+). Optional: without it the app uses the CSS glass look.
    try {
      const gout = path.join(context.appOutDir, '..', 'glass-build-' + arch);
      execFileSync(path.join(__dirname, '..', 'native-glass', 'build.sh'), [arch, gout], { stdio: 'inherit' });
      execFileSync('ditto', [path.join(gout, 'glass.node'), path.join(app, 'Contents', 'Resources', 'glass.node')], { stdio: 'inherit' });
      console.log('[glass] embedded glass.node');
    } catch (e) {
      console.error('\n[glass] WARNING: native Liquid Glass module was NOT added:', e.message, '\n');
    }
    const plugins = path.join(app, 'Contents', 'PlugIns');
    fs.mkdirSync(plugins, { recursive: true });
    fs.rmSync(path.join(plugins, 'TallyWidget.appex'), { recursive: true, force: true });
    execFileSync('ditto', [path.join(work, 'TallyWidget.appex'), path.join(plugins, 'TallyWidget.appex')], { stdio: 'inherit' });
    // Sealing order matters. Intel builds of Electron ship some helper frameworks unsigned, so the app is first signed
    // --deep (which would strip the widget's entitlements), then the widget is signed again with its entitlements, then the
    // app is sealed once more without --deep so the seal covers the final widget and the nested signatures stay as they are.
    const id = process.env.WIDGET_SIGN_IDENTITY || '-';
    const sign = (target, extra) => execFileSync('codesign', ['--force', '--sign', id, ...extra, target], { stdio: 'inherit' });
    sign(app, ['--deep']);
    sign(path.join(plugins, 'TallyWidget.appex'), ['--entitlements', path.join(__dirname, '..', 'native-widget', 'widget.entitlements')]);
    sign(app, []);
    execFileSync('codesign', ['--verify', '--strict', app], { stdio: 'inherit' });
    console.log('[widget] embedded in', app);
  } catch (e) {
    console.error('\n[widget] WARNING: the native widget was NOT added to this build:', e.message, '\n');
    fs.rmSync(path.join(app, 'Contents', 'PlugIns', 'TallyWidget.appex'), { recursive: true, force: true });
  }
};
