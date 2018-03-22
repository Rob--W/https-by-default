'use strict';

var domains_nohttps_input = document.getElementById('domains_nohttps_input');
var enable_logging_input = document.getElementById('enable_logging_input');
var save_button = document.getElementById('save_button');

browser.storage.local.get({
    domains_nohttps: '',
    enable_logging: false,
}).then(({domains_nohttps, enable_logging}) => {
    if (domains_nohttps) {
        domains_nohttps_input.value = domains_nohttps;
    }
    enable_logging_input.checked = enable_logging;
});


let throttle;

function commitChange() {
    clearTimeout(throttle);

    let domains_nohttps = domains_nohttps_input.value;
    // TODO: Validate?
    browser.storage.local.set({domains_nohttps}).then(() => {
        if (domains_nohttps_input.value === domains_nohttps) {
            save_button.value = 'Saved!';
        }
    });
}

save_button.onclick = commitChange;
domains_nohttps_input.onchange = commitChange;
domains_nohttps_input.oninput = () => {
    save_button.value = 'Save';
    clearTimeout(throttle);
    throttle = setTimeout(commitChange, 1000);
};

enable_logging_input.onchange = () => {
    browser.storage.local.set({
        enable_logging: enable_logging_input.checked,
    });
};
