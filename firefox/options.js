'use strict';

var domains_nohttps_input = document.getElementById('domains_nohttps_input');
var save_button = document.getElementById('save_button');

browser.storage.local.get({
    domains_nohttps: '',
}).then(({domains_nohttps}) => {
    if (domains_nohttps) {
        domains_nohttps_input.value = domains_nohttps;
    }
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
