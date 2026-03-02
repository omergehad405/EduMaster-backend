const express = require("express")
const app = express()
const cors = require("cors");
const httpStatusText = require("./utils/httpStatusText");
require("dotenv").config();
const PORT = process.env.PORT || 5000;
const path = require("path");

//middleware 
const frontendOrigins = (process.env.FRONTEND_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

app.use(
    cors({
        origin: (origin, callback) => {
            if (!origin) return callback(null, true);
            if (frontendOrigins.length === 0) return callback(null, true);
            if (frontendOrigins.includes(origin)) return callback(null, true);
            return callback(new Error("Not allowed by CORS"));
        },
        credentials: true,
    })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// routes
const userRoute = require("./routes/users.route");
const tracksRoute = require("./routes/tracks.route");
const adminRoute = require("./routes/admin.routes");
const fileRoutes = require("./routes/file.routes");
const chatRoutes = require("./routes/chat.routes");
const aiRoutes = require("./routes/ai.routes");
const quizRoutes = require("./routes/quiz.route");

app.use("/api/users", userRoute);
app.use("/api/tracks", tracksRoute);
app.use("/api/admin", adminRoute);
app.use("/api/files", fileRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/quizzes", quizRoutes);

//database
const connectDB = require("./config/db");
if (process.env.SKIP_DB === "true" || !process.env.MONGO_URL) {
    console.warn("DB connection skipped (set MONGO_URL to enable DB)");
} else {
    connectDB();
}

// global error handler
app.use((error, req, res, next) => {
    res.status(error.statusCode || 500).json({
        status: httpStatusText.ERROR,
        message: error.message,
    });
});

// start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});