package io.github.mustafaakhan.astra;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.window.OnBackInvokedDispatcher;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebViewAssetLoader;

/**
 * The full-screen window Astra plays in. The game itself is the static site
 * `npm run build` writes to _site/, bundled as this app's assets.
 */
public class MainActivity extends Activity {
    // The site is served from a real https origin rather than file://, so its
    // ES modules, import map, fetch() and localStorage saves work as on the web.
    private static final String ORIGIN = "https://" + WebViewAssetLoader.DEFAULT_DOMAIN;

    // Back is the game's Escape: it closes a dialog, skips a conversation or
    // pauses. When the page has no use for it (the lobby), the app steps into
    // the background as a launcher activity does.
    private static final String BACK = "(function(){"
            + "var layout=document.getElementById('layout-editor'),arranging=!!layout&&!layout.hidden;"
            + "var key={key:'Escape',code:'Escape',keyCode:27,bubbles:true,cancelable:true};"
            + "var down=new KeyboardEvent('keydown',key);dispatchEvent(down);"
            + "dispatchEvent(new KeyboardEvent('keyup',key));"
            + "return arranging||down.defaultPrevented;})()";

    private final int night = Color.rgb(0x13, 0x25, 0x1e);
    private FrameLayout root;
    private WebView web;
    private WebViewAssetLoader site;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        // The HUD sits in the screen's corners, where a camera cutout would hide
        // it: keep the game clear of the cutout and let it show black.
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
            view.setPadding(cutout.left, cutout.top, cutout.right, cutout.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        setContentView(root);

        WebViewAssetLoader.AssetsPathHandler assets = new WebViewAssetLoader.AssetsPathHandler(this);
        site = new WebViewAssetLoader.Builder()
                .addPathHandler("/", path -> assets.handle(path.isEmpty() || path.endsWith("/") ? path + "index.html" : path))
                .build();
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        play();

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::back);
        }
    }

    private void play() {
        web = new WebView(this);
        web.setBackgroundColor(night);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        // The HUD is laid out in pixels; the system font size would break it.
        settings.setTextZoom(100);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return site.shouldInterceptRequest(request.getUrl());
            }

            // Links off the site (the credits) open in the browser.
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request.getUrl().toString().startsWith(ORIGIN + "/")) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()));
                } catch (ActivityNotFoundException ignored) {
                    // Nothing on the device can open it.
                }
                return true;
            }

            // A big world can outgrow the memory the system allows the renderer.
            // When it is reclaimed, start the game again (the save survives in
            // localStorage) rather than take the whole app down with it.
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if (view != web) return true;
                root.removeView(view);
                view.destroy();
                play();
                return true;
            }
        });
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        web.loadUrl(ORIGIN + "/index.html");
    }

    private void back() {
        web.evaluateJavascript(BACK, handled -> {
            if (!"true".equals(handled)) moveTaskToBack(true);
        });
    }

    // Android 12 and older; newer versions call back() through the dispatcher.
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        back();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (!hasFocus) return;
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        bars.hide(WindowInsetsCompat.Type.systemBars());
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        root.removeView(web);
        web.destroy();
        super.onDestroy();
    }
}
