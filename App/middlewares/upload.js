const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Make sure the folder exists
const uploadDir = path.join(__dirname, "../../uploads");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure disk storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + "-" + uniqueSuffix + ext);
    },
});

// ✅ Accept ALL file types — no fileFilter
const upload = multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024 } // 20MB max (optional but recommended)
});

module.exports = upload;