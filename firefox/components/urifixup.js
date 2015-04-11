/**
 * Copyright (c) 2015 Rob Wu <rob@robwu.nl> (https://robwu.nl)
 */
/* globals Components, Services, __URI__ */
/* exported EXPORTED_SYMBOLS, NSGetFactory */

'use strict';
const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;
const NS_URIFIXUP_CONTRACTID = '@mozilla.org/docshell/urifixup;1';
const EXPORTED_SYMBOLS = [];

Cu.import('resource://gre/modules/Services.jsm');


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
    if (aTopic !== 'profile-after-change') {
      return;
    }
    let globalMM = Cc['@mozilla.org/globalmessagemanager;1']
      .getService(Ci.nsIMessageListenerManager);
    // Import the current module in content processes.
    // Yeah, this sucks, but there is no other way to work around
    // https://bugzilla.mozilla.org/show_bug.cgi?id=596880
    globalMM.loadFrameScript(
        'data:,Components.utils.import("' + __URI__ + '");', true);
  },

  // nsIURIFixup
  FIXUP_FLAG_NONE: 0,
  FIXUP_FLAG_ALLOW_KEYWORD_LOOKUP: 1,
  FIXUP_FLAGS_MAKE_ALTERNATE_URI: 2,
  FIXUP_FLAG_REQUIRE_WHITELISTED_HOST: 4,
  FIXUP_FLAG_FIX_SCHEME_TYPOS: 8,

  createExposableURI: function(aURI) {
    return this.DefaultURIFixup.createExposableURI(aURI);
  },

  createFixupURI: function(aURIText, aFixupFlags, aPostData) {
    let fixupInfo;
    try {
      fixupInfo = aPostData ?
        this.getFixupURIInfo(aURIText, aFixupFlags, aPostData) :
        this.getFixupURIInfo(aURIText, aFixupFlags);
    } catch (e) {
    }
    if (fixupInfo) {
      return fixupInfo.preferredURI;
    }
    return null;
  },

  getFixupURIInfo: function(aURIText, aFixupFlags, aPostData) {
    let fixupInfo = aPostData ?
      this.DefaultURIFixup.getFixupURIInfo(aURIText, aFixupFlags, aPostData) :
      this.DefaultURIFixup.getFixupURIInfo(aURIText, aFixupFlags);
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
    return this.DefaultURIFixup.keywordToURI(aKeyword, aPostData);
  },

  // Lazy getter
  get DefaultURIFixup() { // Lazy getter.
    // The default fixup implementation, provided by nsDefaultURIFixup.
    const DefaultURIFixup =
      Components.classesByID['{214c48a0-b57f-11d4-959c-0020183bf181}']
      .getService(Ci.nsIURIFixup);
    Object.defineProperty(this, 'DefaultURIFixup', { value: DefaultURIFixup });
    return DefaultURIFixup;
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

if (Services.appinfo.processType === Services.appinfo.PROCESS_TYPE_CONTENT) {
  let registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
  if (registrar.isCIDRegistered(CustomURIFixup.prototype.classID)) {
    Cu.reportError('Not registering ' + CustomURIFixup.prototype.classID +
        ' because it was already registered.');
  } else {
    registrar.registerFactory(
        CustomURIFixup.prototype.classID,
        CustomURIFixup.prototype.classDescription,
        CustomURIFixup.prototype.contractID,
        factory);
  }
}

function NSGetFactory(cid) {
  if (CustomURIFixup.prototype.classID.toString() === cid.toString()) {
    return factory;
  }
  throw Cr.NS_ERROR_FACTORY_NOT_REGISTERED;
}
