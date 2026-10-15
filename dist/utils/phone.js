"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeIndianPhone = normalizeIndianPhone;
exports.isSamePhone = isSamePhone;
/**
 * Normalizes an Indian mobile number to E.164 (+91XXXXXXXXXX).
 *
 * Accepts "9532977264", "+91 95329 77264", "919532977264", "09532977264".
 * Throws on anything that is not a valid 10-digit Indian mobile, so a typo in
 * config fails loudly instead of messaging a stranger.
 */
function normalizeIndianPhone(input) {
    if (typeof input !== 'string' || input.trim() === '') {
        throw new Error('Phone number is required');
    }
    const digits = input.replace(/[^0-9]/g, '');
    // Strip country code (91) or trunk prefix (0) when present.
    let national;
    if (digits.length === 12 && digits.startsWith('91')) {
        national = digits.slice(2);
    }
    else if (digits.length === 11 && digits.startsWith('0')) {
        national = digits.slice(1);
    }
    else {
        national = digits;
    }
    // Indian mobile numbers are 10 digits starting 6-9.
    if (!/^[6-9]\d{9}$/.test(national)) {
        throw new Error(`Not a valid Indian mobile number: ${input}`);
    }
    return `+91${national}`;
}
function isSamePhone(a, b) {
    try {
        return normalizeIndianPhone(a) === normalizeIndianPhone(b);
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=phone.js.map