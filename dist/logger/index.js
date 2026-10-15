"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const pino_1 = __importDefault(require("pino"));
const config_1 = require("../config");
/**
 * Shared pino logger. Matches the whatsapp-service convention (pino, level
 * from LOG_LEVEL) so both processes log in the same shape.
 */
exports.logger = (0, pino_1.default)({
    level: config_1.config.LOG_LEVEL,
    base: { service: 'catalygn-content-service' },
    timestamp: pino_1.default.stdTimeFunctions.isoTime,
});
//# sourceMappingURL=index.js.map