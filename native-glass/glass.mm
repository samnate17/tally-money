// Tally Money native Liquid Glass addon (macOS 26+).
// Puts Apple's NSGlassEffectView behind the web content of one Electron window. The class is looked up at runtime, so this
// compiles with older SDKs and simply reports "unsupported" on systems that do not have it. N-API, so it loads in Electron unchanged.
#include <napi.h>
#import <AppKit/AppKit.h>
#import <objc/message.h>
#include <map>
#include <string>
#include <vector>

static std::map<int, NSView *> g_views;
static int g_next = 1;

static void OnMain(void (^block)(void)) {
  if ([NSThread isMainThread]) block(); else dispatch_sync(dispatch_get_main_queue(), block);
}

static NSColor *ColorFromHex(NSString *hex) {
  NSString *s = [[hex stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]] uppercaseString];
  if ([s hasPrefix:@"#"]) s = [s substringFromIndex:1];
  if (s.length != 6 && s.length != 8) return nil;
  unsigned int v = 0;
  if (![[NSScanner scannerWithString:s] scanHexInt:&v]) return nil;
  CGFloat r, g, b, a = 1.0;
  if (s.length == 6) { r = ((v >> 16) & 255) / 255.0; g = ((v >> 8) & 255) / 255.0; b = (v & 255) / 255.0; }
  else { r = ((v >> 24) & 255) / 255.0; g = ((v >> 16) & 255) / 255.0; b = ((v >> 8) & 255) / 255.0; a = (v & 255) / 255.0; }
  return [NSColor colorWithSRGBRed:r green:g blue:b alpha:a];
}

static Napi::Value IsSupported(const Napi::CallbackInfo &info) {
  return Napi::Boolean::New(info.Env(), NSClassFromString(@"NSGlassEffectView") != nil);
}

// addGlass(handleBuffer, { cornerRadius?: number, style?: 'regular' | 'clear', tint?: '#RRGGBB[AA]' }) -> id, or -1 when unsupported
static Napi::Value AddGlass(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBuffer()) {
    Napi::TypeError::New(env, "Expected the Buffer from BrowserWindow.getNativeWindowHandle()").ThrowAsJavaScriptException();
    return env.Null();
  }
  Class cls = NSClassFromString(@"NSGlassEffectView");
  if (!cls) return Napi::Number::New(env, -1);
  auto buf = info[0].As<Napi::Buffer<unsigned char>>();
  if (buf.Length() < sizeof(void *)) return Napi::Number::New(env, -1);
  double radius = 0; bool clear = false; std::string tint;
  if (info.Length() > 1 && info[1].IsObject()) {
    Napi::Object o = info[1].As<Napi::Object>();
    if (o.Get("cornerRadius").IsNumber()) radius = o.Get("cornerRadius").As<Napi::Number>().DoubleValue();
    if (o.Get("style").IsString()) clear = o.Get("style").As<Napi::String>().Utf8Value() == "clear";
    if (o.Get("tint").IsString()) tint = o.Get("tint").As<Napi::String>().Utf8Value();
  }
  __block int result = -1;
  unsigned char *data = buf.Data();
  OnMain(^{
    NSView *root = (__bridge NSView *)(*reinterpret_cast<void **>(data));
    if (!root) return;
    NSView *glass = [[cls alloc] initWithFrame:root.bounds];
    glass.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    if ([glass respondsToSelector:@selector(setCornerRadius:)])
      ((void (*)(id, SEL, CGFloat))objc_msgSend)(glass, @selector(setCornerRadius:), (CGFloat)radius);
    if ([glass respondsToSelector:@selector(setStyle:)])
      ((void (*)(id, SEL, NSInteger))objc_msgSend)(glass, @selector(setStyle:), clear ? 1 : 0);
    if (!tint.empty() && [glass respondsToSelector:@selector(setTintColor:)]) {
      NSColor *c = ColorFromHex([NSString stringWithUTF8String:tint.c_str()]);
      if (c) ((void (*)(id, SEL, id))objc_msgSend)(glass, @selector(setTintColor:), c);
    }
    [root addSubview:glass positioned:NSWindowBelow relativeTo:nil];   // behind the web content
    int id = g_next++;
    g_views[id] = glass;
    result = id;
  });
  return Napi::Number::New(env, result);
}

static Napi::Value RemoveGlass(const Napi::CallbackInfo &info) {
  if (info.Length() < 1 || !info[0].IsNumber()) return Napi::Boolean::New(info.Env(), false);
  int id = info[0].As<Napi::Number>().Int32Value();
  OnMain(^{
    auto it = g_views.find(id);
    if (it != g_views.end()) { [it->second removeFromSuperview]; g_views.erase(it); }
  });
  return Napi::Boolean::New(info.Env(), true);
}

// describe(handleBuffer) -> class names of the window content view's subviews, bottom to top. Used by the CI smoke test.
static Napi::Value Describe(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  Napi::Array out = Napi::Array::New(env);
  if (info.Length() < 1 || !info[0].IsBuffer()) return out;
  unsigned char *data = info[0].As<Napi::Buffer<unsigned char>>().Data();
  __block std::vector<std::string> names;
  OnMain(^{
    NSView *root = (__bridge NSView *)(*reinterpret_cast<void **>(data));
    if (!root) return;
    for (NSView *v in root.subviews) names.push_back(std::string([NSStringFromClass([v class]) UTF8String]));
  });
  for (size_t i = 0; i < names.size(); i++) out.Set((uint32_t)i, Napi::String::New(env, names[i]));
  return out;
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("isSupported", Napi::Function::New(env, IsSupported));
  exports.Set("addGlass", Napi::Function::New(env, AddGlass));
  exports.Set("removeGlass", Napi::Function::New(env, RemoveGlass));
  exports.Set("describe", Napi::Function::New(env, Describe));
  return exports;
}
NODE_API_MODULE(tally_glass, Init)
