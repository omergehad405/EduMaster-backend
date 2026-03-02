const httpStatusText = require("./httpStatusText")

class appError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode
        this.statusText =
            statusCode >= 400 & statusCode <= 500
                ? httpStatusText.FAIL
                : httpStatusText.ERROR;
        this.isOperational = true;
    }
}

module.exports = appError