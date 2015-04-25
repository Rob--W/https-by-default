# HTTPS by default

Upon requesting "example.com" from the location bar, your browser will attempt
to load `http://example.com` over an insecure connection by default.
Those who want to load the site over a secure connection have to manually put
"https://" in front of the URL. Because it is easier to not type "https://",
most websites are accessed over an insecure connection.

This project is an endeavour to get HTTPS to become the default scheme in web
browsers. With the following instructions, requesting `example.com` from the
location bar will result in a navigation to `https://example.com` instead of
`http://example.com` (which is the current ubiquitous but insecure default).

Some websites are incorrectly configured and cannot be accessed over a secure
connection. If you come across such a site, edit the URL in the location bar
and insert "http://" in front of it to access the site anyway.

Many of these days' web browsers hide the "http://" prefix in the location bar.
When "http" is the default scheme, focusing the location bar and pressing Enter
will trigger a navigation to the same URL, i.e. reload the current page. With
https enabled by default, the page will not be reloaded, but you will be
navigated to the https-version of the site instead (unless you put "http://" in
front of the URL).


# Firefox

Install the [HTTPS by default add-on](https://addons.mozilla.org/en-US/firefox/addon/https-by-default)
to enable https by default in Firefox.

Visit `about:config` and set `browser.urlbar.trimURLs` to `false` to not hide
the "http://" prefix by default.

NOTE: This add-on does not work yet with multi-process Firefox (e10s) because
add-ons cannot register components in the content process in a timely fashion:
https://bugzilla.mozilla.org/show_bug.cgi?id=1131065


# Chrome / Chromium

Chrome's extension APIs is not powerful enough to support this feature.
See https://stackoverflow.com/a/26462483/938089 for instructions on getting and
compiling a stable version of Chrome. Before compiling, apply the patch from
this repository to get https by default:

```sh
cd chromium/src   # this is the location of Chromium's git repository
git apply https-by-default.patch   # the .patch file from this repo at chrome/.
```


# Roadmap

At the initial stage, the project's focus is to offer the option to enable https
by default in web browsers. The ultimate goal is to get browser vendors to
enable https by default. This is a significant change, and as such it will need
compelling data to demonstrate that the change does not hinder usability. If the
extensions from this project take off, I could update them to measure the impact
of https by default on usability. This feature will only be added if it can be
done without compromising the users' privacy.


# Alternatives

- HTTPS Everywhere (https://www.eff.org/https-everywhere)

  This is a Firefox addon and a Chrome extension that contains a huge database
  of rules which redirects http requests to https. This characteristic is its
  forte and also its weakness. The rules allows the add-on to force https for
  *known* sites. Unlisted sites will still be accessed over an insecure
  connection by default.
  
- HTTP Strict Transport Security (https://www.owasp.org/index.php/HTTP_Strict_Transport_Security)

  Website authors can include the `Strict-Transport-Security` in their secure
  response to tell the browser to force https for subsequent visits to the site.
  This *only* works if the website author adds this STS header *and* if the user
  visits the site at least once over https, or if the site was registered in a
  pre-loaded HSTS list. Unfortunately, the combination of both is not quite
  common.
