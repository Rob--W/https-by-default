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

browser.tabs.onCreated.addListener(tab => {
    if (tab.id) {
        tabCreationTimes.set(tab.id, Date.now());
    }
});
browser.tabs.onRemoved.addListener(tabId => {
    tabCreationTimes.delete(tabId);
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
    if (currentTab && currentTab.url === 'about:blank' && (
        // Typing a site takes time, so it is reasonable to choose a relatively
        // long time threshold. One second is a very realistic underbound for
        // typing some domain name. It is also large enough to allow the browser
        // to process the request, even if the device is very slow (CPU-wise).
        details.timeStamp - currentTab.lastAccessed < 1000 ||
        // If the tab is created around the same time as the request, then this
        // is possibly an Alt-Enter navigation on Firefox Desktop.
        // But it can also be a bookmark opened in a new tab, an
        // extension-created tab (#15) or a URL opened via the command line (#14).
        // The latter cases are probably more common, so we don't redirect for
        // these.
        tabCreationTimes.get(tabId) === undefined ||
        details.timeStamp - tabCreationTimes.get(tabId) < 300)) {
        return;
    }

    if (currentTab && currentTab.url === requestedUrl) {
        // In Firefox, tab.url shows the URL of the currently loaded resource in
        // a tab, so if the URL is equal to the requested URL, it is a page reload.
        return;
    }

    // Replace "http:" with "https:".
    let httpsUrl = requestedUrl.replace(':', 's:');

    if (currentTab && currentTab.url === httpsUrl) {
        // Don't rewrite if the current page's URL is identical to the target URL.
        // This is for the following scenario:
        // - User opens http://xxx
        // - The extension redirects to https://xxx
        // - ... but https://xxx is not serving the content that the user expects
        // - User opens http://xxx again
        // - Extension should not redirect to https.
        return;
    }

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
