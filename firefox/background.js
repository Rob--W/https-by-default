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

browser.webRequest.onBeforeRequest.addListener(async (details) => {
    if (details.originUrl) {
        // Likely a web-triggered navigation, or a reload of such a page.
        return;
    }

    // Possibly a navigation from the awesomebar, bookmark, etc.

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

    let currentUrl;
    let tabPromise = browser.tabs.get(tabId);
    try {
        currentUrl = (await browser.webNavigation.getFrame({
            tabId,
            frameId: 0,
        })).url;
    } catch (e) {
        // Current tab has no valid page (e.g. SSL connection error).
        try {
            currentUrl = (await tabPromise).url;
        } catch (e) {
            // Tab does not exist. E.g. when a URL is loaded in a new tab page.
            currentUrl = '';
        }
    }

    // Replace "http:" with "https:".
    let httpsUrl = requestedUrl.replace(':', 's:');

    if (currentUrl === httpsUrl) {
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
