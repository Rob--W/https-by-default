/**
 * Copyright (c) 2017 Rob Wu <rob@robwu.nl> (https://robwu.nl)
 */
'use strict';

const DOMAIN_WILDCARD_LEAF_SYMBOL = Symbol('Domain wildcard prefix');

var prefsParsed = {
    domains_nohttps: new Map(),
};
var prefsReady = false;
var prefsReadyPromise = browser.storage.local.get({
    domains_nohttps: '',
})
.then(({domains_nohttps}) => doParsePrefs(domains_nohttps), (() => {}))
.then(() => { prefsReady = true; });

browser.storage.onChanged.addListener((changes) => {
    if (changes.domains_nohttps) {
        doParsePrefs(changes.domains_nohttps.newValue);
    }
});


var tabCreationTimes = new Map();
var tabActivatedTimes = new Map();

browser.tabs.onCreated.addListener(tab => {
    if (tab.id) {
        tabCreationTimes.set(tab.id, Date.now());
        if (tab.active) {
            tabActivatedTimes.set(tab.id, Date.now());
        }
    }
});
browser.tabs.onActivated.addListener(({tabId}) => {
    tabActivatedTimes.set(tabId, Date.now());
});
browser.tabs.onRemoved.addListener(tabId => {
    tabCreationTimes.delete(tabId);
    tabActivatedTimes.delete(tabId);
});
browser.tabs.query({}).then(tabs => {
    for (let tab of tabs) {
        // If the extension is loading around Firefox's start-up, then we
        // should not rewrite URLs.
        // If the extension was loaded long after Firefox's start-up, then
        // these timestamps are probably in the past (or the tab is not
        // an about:blank page), and we will not inadvertently stop the
        // redirect from happening.
        tabCreationTimes.set(tab.id, tab.lastAccessed || Date.now());
        tabActivatedTimes.set(tab.id, tab.active ? Date.now() : 0);
    }
});

browser.webRequest.onBeforeRequest.addListener(async (details) => {
    if (details.originUrl) {
        // Likely a web-triggered navigation, or a reload of such a page.
        return;
    }
    if (details.tabId === -1) {
        // Invisible navigation. Unlikely to be requested by the user.
        return;
    }

    // Possibly a navigation from the awesomebar, bookmark, etc.
    // ... or a reload of a (discarded) tab.

    // I would like to only rewrite typed URLs without explicit scheme,
    // but unfortunately the extension API does not offer the typed text,
    // so we will rewrite any non-web-initiated navigation,
    // including bookmarks, auto-completed URLs and full URLs with "http:" prefix.

    let {tabId, url: requestedUrl} = details;

    if (!prefsReady) {
        await prefsReadyPromise;
    }

    if (!shouldRedirectToHttps(requestedUrl)) {
        return;
    }

    let currentTab;
    for (let start = Date.now(); Date.now() - start < 200; ) {
        try {
            currentTab = await browser.tabs.get(tabId);
        } catch (e) {
            // Tab does not exist. E.g. when a URL is loaded in a new tab page
            // and the request happens before the tab exists.
            await new Promise(resolve => { setTimeout(resolve, 20); });
        }
    }

    // Heuristic: On Firefox for Android, tabs can be discarded (and its URL
    // becomes "about:blank"). When a tab is re-activated, the original URL is
    // loaded again. These URLs should not be modified by us.
    // On Firefox for Desktop, this can also be a new tab of unknown origin.
    if (currentTab && currentTab.url === 'about:blank') {
        let tabCreationTime = tabCreationTimes.get(tabId);
        if (tabCreationTime === undefined) {
            // The request was generated before the tab was created,
            // or the tab has been removed.
            return;
        }
        let tabActivatedTime = tabActivatedTimes.get(tabId);
        if (tabId === undefined) {
            // If the time of when the tab was first activated is unknown,
            // fall back to the time of when the time was last activated.
            tabActivatedTime = currentTab.lastAccessed;
        }
        // Typing a site takes time, so it is reasonable to choose a relatively
        // long time threshold. One second is a very realistic underbound for
        // typing some domain name. It is also large enough to allow the browser
        // to process the request, even if the device is very slow (CPU-wise).
        if (details.timeStamp - tabActivatedTime < 1000) {
            // Likely resuming from a discarded tab on Android.
            return;
        }
        // If the tab is created around the same time as the request, then this
        // is possibly an Alt-Enter navigation on Firefox Desktop.
        // But it can also be a bookmark opened in a new tab, an
        // extension-created tab (#15) or a URL opened via the command line (#14).
        // The latter cases are probably more common, so we don't redirect for
        // these.
        if (details.timeStamp - tabCreationTimes.get(tabId) < 300) {
            return;
        }
    }

    if (currentTab && isDerivedURL(currentTab.url, requestedUrl)) {
        // User had likely edited the current URL and pressed Enter.
        // Do not rewrite the request to HTTPS.
        return;
    }

    // Replace "http:" with "https:".
    let httpsUrl = requestedUrl.replace(':', 's:');

    return {
        redirectUrl: httpsUrl,
    };
}, {
    urls: ['http://*/*'],
    types: ['main_frame']
}, ['blocking']);

/**
 * Determines whether the given http:-URL should be redirected to https:.
 *
 * @param {string} requestedUrl A valid http:-URL.
 * @returns {boolean} Whether to redirect to https.
 */
function shouldRedirectToHttps(requestedUrl) {
    let {hostname} = new URL(requestedUrl);

    if (!hostname.includes('.')) {
        // Any globally resolvable address should have a TLD.
        // Otherwise it is not likely to obtain a SSL certificate for it.
        // E.g. localhost.
        return false;
    }

    if (hostname.endsWith('.test') ||
        hostname.endsWith('.example') ||
        hostname.endsWith('.invalid') ||
        hostname.endsWith('.localhost')) {
        // Reserved root level DNS names - RFC 2606.
        return false;
    }

    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
        hostname.startsWith('[') && hostname.endsWith(']')) {
        // Don't redirect IPv4 or IPv6 addresses.
        return false;
    }

    let map = prefsParsed.domains_nohttps;
    for (let part of hostname.split('.').reverse()) {
        map = map.get(part);
        if (!map) {
            break;
        }
        if (map.has(DOMAIN_WILDCARD_LEAF_SYMBOL)) {
            return false;
        }
    }

    // By default, redirect to https:.
    return true;
}

/**
 * Determines whether the requested URL is based on the current URL.
 *
 * @param {string} currentUrl - The current URL of the tab.
 * @param {string} requestedUrl - The requested http:-URL.
 * @returns {boolean} Whether to avoid rewriting the request to https.
 */
function isDerivedURL(currentUrl, requestedUrl) {
    if (currentUrl === requestedUrl) {
        // In Firefox, tab.url shows the URL of the currently loaded resource in
        // a tab, so if the URLs are equal, it is a page reload.
        return true;
    }
    if (!currentUrl.startsWith('http')) {
        // Not a http(s) URL, e.g. about:.
        return false;
    }
    let cur;
    try {
        cur = new URL(currentUrl);
    } catch (e) {
        return false;
    }
    let req = new URL(requestedUrl);
    if (req.hostname === cur.hostname) {
        // The user had already accessed the domain over HTTP, so there is no
        // much gain in forcing a redirect to HTTPS.
        //
        // This supports the use case of editing the current (HTTP) URL and
        // then navigating to it.
        //
        // This also covers the following scenario:
        // - User opens http://xxx
        // - The extension redirects to https://xxx
        // - ...but https://xxx is not serving the content that the user expects
        // - User opens http://xxx again
        // - Extension should not redirect to https.
        return true;
    }

    if (cur.protocol === 'https:') {
        // If the current tab's URL is https, do not downgrade to http.
        return false;
    }

    if ((req.pathname.length > 1 ||
         req.search.length > 2 ||
         req.hash.length > 2) &&
        req.pathname === cur.pathname &&
        req.search === cur.search &&
        req.hash === cur.hash) {
        // Everything after the domain name is non-empty and equal.
        // The user might be trying to correct a misspelled domain name.
        // Do not rewrite to HTTPS.
        return true;
    }

    // Proceed to redirect to https.
    return false;
}

function doParsePrefs(domains_nohttps) {
    prefsParsed.domains_nohttps = new Map();
    if (domains_nohttps) {
        console.assert(typeof domains_nohttps === 'string');
        for (let domain of domains_nohttps.split(/\s+/)) {
            if (!domain) {
                continue;
            }
            let map = prefsParsed.domains_nohttps;
            for (let part of domain.split('.').reverse()) {
                if (!map.has(part)) {
                    map.set(part, new Map());
                }
                map = map.get(part);
            }
            map.set(DOMAIN_WILDCARD_LEAF_SYMBOL);
        }
    }
}
