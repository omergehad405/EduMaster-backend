const jwt = require("jsonwebtoken");
const appError = require("../../utils/appError")

const verifyToken = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization || req.headers.Authorization;
        if (!authHeader) {
            return next(new appError("Token is Required", 401))
        }

        const token = authHeader.split(" ")[1];
        if (!token) {
            return next(new appError("invalid token format", 401))
        }

        if (!process.env.JWT_SECRET_KEY) {
            console.error("❌ JWT_SECRET_KEY missing from .env");
            return next(new appError(("Server configuration error", 500)));
        }

        const currentUser = jwt.verify(token, process.env.JWT_SECRET_KEY);
        req.user = currentUser;

        next();

    }
    catch (err) {
        console.error("❌ Token verification failed:", err.message);
        return next(new appError("Invalid token", 401))
    }
}

module.exports = verifyToken;
