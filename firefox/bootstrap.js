/**
 * Copyright (c) 2015 Rob Wu <rob@robwu.nl> (https://robwu.nl)
 */
/* globals Components, APP_SHUTDOWN, console */

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

// Whether the addon is still active. When the add-on unloads, it attempts to
// restore the monkey-patched openLinkIn method. When this is not possible, e.g.
// because another addon has overwritten the method, then this value is used to
// disable the monkey-patched behavior.
let isEnabled = false;


/**
 * @param {string} url - whatever the user typed in the location bar.
 * @return {string} If |url| has no scheme and it is fixed up by setting its
 *   scheme to http, then the result is the fixed-up URL, using https instead of
 *   http. Otherwise the original url is returned.
 */
function maybeFixupURL(url) {
  if (/^[a-z][a-z0-9+\-.]*:/i.test(url)) {
    // The URL already has a scheme. Don't call fixup.
    return url;
  }
  let flags =
    Ci.nsIWebNavigation.LOAD_FLAGS_ALLOW_THIRD_PARTY_FIXUP |
    Ci.nsIWebNavigation.LOAD_FLAGS_FIXUP_SCHEME_TYPOS;

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
 * Monkey-patch the openLinkIn method if the given window is a browser window.
 *
 * @param {nsIDOMWindow} window - browser window.
 */
function patchTabBrowserWindow(window) {
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
  window.openLinkIn = function openLinkIn_withHttpsFixup(url, where, params) {
    if (isEnabled && params && params.allowThirdPartyFixup) {
      arguments[0] = maybeFixupURL(url);
    }
    return openLinkIn.apply(this, arguments);
  };
  window.openLinkIn[ADDON_SESSION_TAG] = openLinkIn;
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
    let openLinkIn = window.openLinkIn;
    // Restore original method if possible. If not possible, isEnabled=false
    // ensures that the functionality is disabled.
    if (openLinkIn && openLinkIn[ADDON_SESSION_TAG]) {
      window.openLinkIn = openLinkIn[ADDON_SESSION_TAG];
    }
  });
}

function uninstall() {}
