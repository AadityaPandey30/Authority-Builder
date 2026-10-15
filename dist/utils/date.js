"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IST = void 0;
exports.istDateString = istDateString;
exports.istIsoString = istIsoString;
/**
 * Date helpers pinned to Asia/Kolkata, so "today" means today in IST regardless
 * of the host's TZ. Uses Intl rather than a date library to stay dependency-free.
 */
const IST_TIME_ZONE = 'Asia/Kolkata';
const istDateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});
/** Returns the IST calendar date as YYYY-MM-DD. */
function istDateString(date = new Date()) {
    return istDateFormatter.format(date);
}
/** Human-readable IST timestamp, used in logs and diagnostics. */
function istIsoString(date = new Date()) {
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: IST_TIME_ZONE,
        dateStyle: 'full',
        timeStyle: 'long',
    }).format(date);
}
exports.IST = IST_TIME_ZONE;
//# sourceMappingURL=date.js.map