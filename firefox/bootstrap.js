/**
 * Copyright (c) 2015 Rob Wu <rob@robwu.nl> (https://robwu.nl)
 */
/* globals Components, APP_SHUTDOWN, console */

/* jshint esversion:6 */
/* exported startup, install, shutdown, uninstall */
'use strict';

const {
  classes: Cc,
  interfaces: Ci
} = Components;

const sURIFixup =
  Cc['@mozilla.org/docshell/urifixup;1']
  .getService(Ci.nsIURIFixup);

// Some pseudo-random unique value, used to label monkey-patched methods.
const ADDON_SESSION_TAG = 'https by default ' + Math.random().toString(36);

// Whether we are on Firefox for Android.
let isFennec = '{aa3c5121-dab2-40e2-81ca-7ea25febc110}' ===
  Cc['@mozilla.org/xre/app-info;1'].getService(Ci.nsIXULAppInfo).ID;

// Whether the addon is still active. When the add-on unloads, it attempts to
// restore the monkey-patched openLinkIn method. When this is not possible, e.g.
// because another addon has overwritten the method, then this value is used to
// disable the monkey-patched behavior.
let isEnabled = false;


const patchTabBrowserWindow = isFennec ? patchFennecWindow : patchFirefoxWindow;

/**
 * @param {string} url - whatever the user typed in the location bar.
 * @return {string} If |url| has no scheme and it is fixed up by setting its
 *   scheme to http, then the result is the fixed-up URL, using https instead of
 *   http. Otherwise the original url is returned.
 */
function maybeFixupURL(url) {
  if (!isEnabled) {
    return url;
  }
  url = url.trim().replace(/[\r\n]/g, '');
  if (/^[a-z][a-z0-9+\-.]*:/i.test(url)) {
    // The URL already has a scheme. Don't call fixup.
    return url;
  }
  let flags = Ci.nsIURIFixup.FIXUP_FLAG_REQUIRE_WHITELISTED_HOST |
    Ci.nsIURIFixup.FIXUP_FLAG_ALLOW_KEYWORD_LOOKUP;
  let fixupInfo;

  try {
    fixupInfo = sURIFixup.getFixupURIInfo(url, flags);
  } catch (e) {}

  if (fixupInfo &&
      fixupInfo.fixupChangedProtocol &&
      fixupInfo.preferredURI &&
      fixupInfo.preferredURI.schemeIs('http')) {
    // If the fix-up is a protocol, by adding http, assume that nsIURIFixup
    // went through the nsDefaultURIFixup::FixupURIProtocol code path and
    // prepended the http scheme. Change to https instead.
    fixupInfo.preferredURI.scheme = 'https';
    return fixupInfo.preferredURI.spec;
  }

  return url;
}

/**
 * FOR FIREFOX DESKTOP.
 * Monkey-patch the openLinkIn method if the given window is a browser window.
 *
 * @param {nsIDOMWindow} window - browser window.
 */
function patchFirefoxWindow(window) {
  const openLinkIn = window.openLinkIn;
  if (!openLinkIn) {
    let windowtype = window.document.documentElement.getAttribute('windowtype');
    if (windowtype === 'navigator:browser') {
      // This should not happen. openLinkIn always exists in tabbrowser windows.
      // If this branch is reached, then most likely the openLinkIn function has
      // been deleted, and the add-on needs to be updated.
      console.warn('openLinkIn method not found in tabbrowser!');
    }
    return;
  }

  if (openLinkIn.length !== 3) {
    console.warn('Function signature of openLinkIn changed. Expecting 3 ' +
        'arguments, but saw ' + openLinkIn.length + ' instead.');
    // Do not return, because the monkey-patch is transparent.
  }

  // Monkey-patch openLinkIn.
  // This method is implemented in browser/base/content/utilityOverlay.js.
  /* jshint validthis:true */
  function openLinkIn_withHttpsFixup(url, where, params) {
    if (isEnabled && params && params.allowThirdPartyFixup) {
      arguments[0] = maybeFixupURL(url);
    }
    return openLinkIn.apply(this, arguments);
  }
  openLinkIn_withHttpsFixup[ADDON_SESSION_TAG] = openLinkIn;

  // There are crazy addons who try to monkey-patch by serializing functions...
  // See https://github.com/Rob--W/https-by-default/issues/7.
  // Let's return the original serialization plus a very conservative line that
  // attempts to use the method exported below. The line is not expected to
  // fail, but just in case another addon does something even crazier, wrap it
  // in a try-catch.
  openLinkIn_withHttpsFixup.toString = function() {
    var signature = /\(url,\s*where,\s*params\)\s*\{/;
    return openLinkIn.toString().replace(signature,
        '$&\ntry{if(params&&params.allowThirdPartyFixup)' +
          'url=window._https_by_default_maybeFixupURL(url);}catch(e){}\n');
  };
  Object.defineProperty(window, '_https_by_default_maybeFixupURL', {
    configurable: true,
    value: maybeFixupURL,
  });
  window.openLinkIn = openLinkIn_withHttpsFixup;
}

/**
 * FOR FIREFOX FOR ANDROID (Fennec).
 * Monkey-patch the BrowserApp.loadURI method.
 */
function patchFennecWindow(window) {
  // This function has a structure similar to patchTabBrowserWindow.
  const loadURI = window.BrowserApp && window.BrowserApp.loadURI;
  if (!loadURI) {
    let windowtype = window.document.documentElement.getAttribute('windowtype');
    if (windowtype === 'navigator:browser') {
      if (window.BrowserApp) {
        console.warn('BrowserApp.loadURI method not found in tabbrowser!');
      } else {
        console.warn('BrowserApp object not found in mobile tabbrowser!');
      }
    }
    return;
  }

  if (loadURI.length !== 3) {
    console.warn('Function signature of BrowserApp.loadURI has changed!');
  }

  function BrowserApp_loadURI_withHttpsFixup(aURI, aBrowser, aParams) {
    // These parameters are set in mobile/android/chrome/content/browser.js,
    // in the observe method, case "Tab:Load" (which in turn is triggered by
    // loadUrl(String,String,int,int) in mobile/android/base/Tabs.java).
    if (isEnabled && aParams && aParams.userRequested && !aParams.isSearch) {
      arguments[0] = maybeFixupURL(aURI);
    }
    return loadURI.apply(this, arguments);
  }
  BrowserApp_loadURI_withHttpsFixup[ADDON_SESSION_TAG] = loadURI;
  window.BrowserApp.loadURI = BrowserApp_loadURI_withHttpsFixup;
}

/**
 * The DOMContentLoaded event handler, bound to the nsIDOMWindow object of a
 * browser window.
 */
function onDOMContentLoaded(event) {
  let window = event.currentTarget;
  if (event.target !== window.document) {
    // The DOMContentLoaded event bubbles, and could be triggered by one of
    // the frames (not the main window).
    return;
  }
  // DOMContentLoaded should be handled only once.
  window.removeEventListener('DOMContentLoaded', onDOMContentLoaded);
  let windowtype = window.document.documentElement.getAttribute('windowtype');
  if (windowtype === 'navigator:browser') {
    patchTabBrowserWindow(window);
  }
}

/**
 * Enumerate all tabbrowser windows.
 * @param {function(nsIDOMWindow)} callback - Called for every tabbrowser
 *   window.
 */
function forEachBrowserWindow(callback) {
  let wm = Cc['@mozilla.org/appshell/window-mediator;1']
    .getService(Ci.nsIWindowMediator);
  let windows = wm.getEnumerator('navigator:browser');
  while (windows.hasMoreElements()) {
    let window = windows.getNext();
    callback(window);
  }
}

const wwObserver = {
  observe: function(aSubject, aTopic) {
    if (aTopic !== 'domwindowopened') {
      return;
    }
    let window = aSubject.QueryInterface(Ci.nsIDOMWindow);
    window.addEventListener('DOMContentLoaded', onDOMContentLoaded);
  }
};

function startup() {
  isEnabled = true;

  Cc['@mozilla.org/embedcomp/window-watcher;1']
    .getService(Ci.nsIWindowWatcher)
    .registerNotification(wwObserver);

  forEachBrowserWindow(function(window) {
    let readyState = window.document.readyState;
    if (readyState !== 'interactive' && readyState !== 'complete') {
      window.addEventListener('DOMContentLoaded', onDOMContentLoaded);
    } else {
      patchTabBrowserWindow(window);
    }
  });
}

function install() {}

function shutdown(data, reason) {
  // Don't bother restoring the old state upon shutdown of the browser.
  if (reason === APP_SHUTDOWN)
    return;
  isEnabled = false;

  Cc['@mozilla.org/embedcomp/window-watcher;1']
    .getService(Ci.nsIWindowWatcher)
    .unregisterNotification(wwObserver);

  forEachBrowserWindow(function undoPatch(window) {
    window.removeEventListener('DOMContentLoaded', onDOMContentLoaded);

    // Restore original method if possible. If not possible, isEnabled=false
    // ensures that the functionality is disabled.
    if (isFennec) {
      let loadURI = window.BrowserApp && window.BrowserApp.loadURI;
      if (loadURI && loadURI[ADDON_SESSION_TAG]) {
        window.BrowserApp.loadURI = loadURI[ADDON_SESSION_TAG];
      }
    } else { // Desktop Firefox
      let openLinkIn = window.openLinkIn;
      if (openLinkIn && openLinkIn[ADDON_SESSION_TAG]) {
        window.openLinkIn = openLinkIn[ADDON_SESSION_TAG];
        delete window._https_by_default_maybeFixupURL;
      }
    }
  });
}

function uninstall() {}
