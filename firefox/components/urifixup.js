/**
 * Copyright (c) 2015 Rob Wu <rob@robwu.nl> (https://robwu.nl)
 */
/* globals Components, console */
/* exported NSGetFactory */

'use strict';
const Ci = Components.interfaces;
const Cr = Components.results;
const NS_URIFIXUP_CONTRACTID = '@mozilla.org/docshell/urifixup;1';

// The default fixup implementation, provided by nsDefaultURIFixup.
const DefaultURIFixup =
  Components.classesByID['{214c48a0-b57f-11d4-959c-0020183bf181}']
  .getService(Ci.nsIURIFixup);

function CustomURIFixup() {
}

CustomURIFixup.prototype = {
  // Metadata used by factory.
  classID: Components.ID('4262ff38-28eb-4845-b8f0-01262fdb72d5'),
  classDescription: 'Add https instead of http if scheme is not specified.',
  contractID: NS_URIFIXUP_CONTRACTID,

  // nsISupports
  QueryInterface: function CustomURIFixup_QueryInterface(iid) {
    if (Ci.nsISupports.equals(iid))
      return this;
    if (Ci.nsIObserver.equals(iid))
      return this;
    if (Ci.nsIURIFixup.equals(iid))
      return this;
    throw Cr.NS_ERROR_NO_INTERFACE;
  },

  // nsIObserver
  observe: function(aSubject, aTopic, aData) {
    // This observer is triggered by nsXREDirProvider::DoStartup, via
    // NS_CreateServicesFromCategory.
    // aSubject == null
    // aTopic == 'profile-after-change'
    // aData == ''
    // We do not handle the notification, because the only purpose of adding the
    // module to the profile-after-change category is to get the module to
    // initialize before nsDocShell is constructed.
  },

  // nsIURIFixup
  FIXUP_FLAG_NONE: 0,
  FIXUP_FLAG_ALLOW_KEYWORD_LOOKUP: 1,
  FIXUP_FLAGS_MAKE_ALTERNATE_URI: 2,
  FIXUP_FLAG_REQUIRE_WHITELISTED_HOST: 4,
  FIXUP_FLAG_FIX_SCHEME_TYPOS: 8,

  createExposableURI: function(aURI) {
    return DefaultURIFixup.createExposableURI(aURI);
  },

  createFixupURI: function(aURIText, aFixupFlags, aPostData) {
    let fixupInfo;
    try {
      fixupInfo = this.getFixupURIInfo(aURIText, aFixupFlags, aPostData);
    } catch (e) {
    }
    if (fixupInfo) {
      return fixupInfo.preferredURI;
    }
    return null;
  },

  getFixupURIInfo: function(aURIText, aFixupFlags, aPostData) {
    let fixupInfo =
      DefaultURIFixup.getFixupURIInfo(aURIText, aFixupFlags, aPostData);
    // If the protocol was fixed-up to http, AND
    // the original URI did not start with a RFC 2396-compliant scheme,
    // then assume that the URI was fixed-up by prefixing the default protocol,
    // i.e. 'http://' by nsDefaultURIFixup::FixupURIProtocol.
    if (fixupInfo &&
        fixupInfo.fixupChangedProtocol &&
        fixupInfo.preferredURI &&
        fixupInfo.preferredURI.schemeIs('http') &&
        !/^[a-z][a-z0-9+\-.]*:/i.test(aURIText)) {
      fixupInfo.preferredURI.scheme = 'https';
    }
    return fixupInfo;
  },

  keywordToURI: function(aKeyword, aPostData) {
    return DefaultURIFixup.keywordToURI(aKeyword, aPostData);
  },
};

const factory = {
  // nsISupports
  QueryInterface: function ComponentFactory_QueryInterface(iid) {
    if (Ci.nsISupports.equals(iid))
      return this;
    if (Ci.nsIFactory.equals(iid))
      return this;
    throw Cr.NS_ERROR_NO_INTERFACE;
  },

  // nsIFactory
  createInstance: function ComponentFactory_createInstance(aOuter, iid) {
    if (aOuter)
      throw Cr.NS_ERROR_NO_AGGREGATION;
    return new CustomURIFixup().QueryInterface(iid);
  },

  lockFactory: function ComponentFactory_lockFactory(aDoLock) {
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
  },
};

function NSGetFactory(cid) {
  if (CustomURIFixup.prototype.classID.toString() === cid.toString()) {
    return factory;
  }
  throw Cr.NS_ERROR_FACTORY_NOT_REGISTERED;
}
