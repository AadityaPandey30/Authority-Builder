"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectDb = connectDb;
exports.disconnectDb = disconnectDb;
const mongoose_1 = __importDefault(require("mongoose"));
const config_1 = require("../config");
const logger_1 = require("../logger");
/** Reuses the existing MongoDB infrastructure (same instance as the CRM). */
async function connectDb() {
    mongoose_1.default.set('strictQuery', true);
    await mongoose_1.default.connect(config_1.config.MONGODB_URI, {
        serverSelectionTimeoutMS: 10_000,
    });
    logger_1.logger.info({ db: mongoose_1.default.connection.name }, 'mongodb connected');
    return mongoose_1.default;
}
async function disconnectDb() {
    await mongoose_1.default.disconnect();
}
//# sourceMappingURL=db.js.map